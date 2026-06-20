const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const { supabase } = require('./lib/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'romanoku-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// ===== UPLOAD SETUP (MEMORY) =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ===== DATA HELPERS =====
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function generateId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-');
}

function shuffle(arr) {
  return [...arr].sort(() => 0.5 - Math.random());
}

async function getUser(req) {
  if (!req.session || !req.session.userId) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.session.userId)
      .single();
    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function getCategories() {
  try {
    const { data, error } = await supabase
      .from('books')
      .select('category');
    if (error || !data) return [];
    const categories = data.map(b => b.category);
    return [...new Set(categories)].map(cat => {
      const count = categories.filter(b => b === cat).length;
      return { name: cat, count };
    });
  } catch (e) {
    return [];
  }
}

// ===== MIDDLEWARE: Make auth available to all templates =====
app.use(async (req, res, next) => {
  try {
    const user = await getUser(req);
    res.locals.user = user;
    res.locals.isLoggedIn = !!user;
    res.locals.categories = await getCategories();
  } catch (e) {
    res.locals.user = null;
    res.locals.isLoggedIn = false;
    res.locals.categories = [];
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// ===== ROUTES =====
app.get('/', async (req, res) => {
  try {
    const { data: books, error } = await supabase
      .from('books')
      .select('*')
      .order('reads', { ascending: false });
      
    const popular = books ? books.slice(0, 8) : [];
    const latest = books ? shuffle(books).slice(0, 8) : [];
    const featured = books && books.length > 0 ? (books.find(b => b.id === 9) || books[0]) : null;
    
    res.locals.page = 'home';
    res.render('index', {
      books: books || [],
      popular,
      latest,
      featured
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

app.get('/books', async (req, res) => {
  res.locals.page = 'books';
  const q = req.query.q || '';
  const cat = req.query.category || '';
  const sort = req.query.sort || 'popular';

  try {
    let query = supabase.from('books').select('*');
    if (cat) query = query.eq('category', cat);
    if (q) query = query.or(`title.ilike.%${q}%,author.ilike.%${q}%`);

    const { data: books, error } = await query;
    let filtered = books ? [...books] : [];

    if (sort === 'rating') filtered.sort((a, b) => b.rating - a.rating);
    else if (sort === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
    else if (sort === 'newest') filtered.sort((a, b) => b.year - a.year);
    else filtered.sort((a, b) => b.reads - a.reads);

    res.render('books', { books: filtered, q, cat, sort });
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

app.get('/book/:slug', async (req, res) => {
  res.locals.page = 'book';
  try {
    const { data: book, error } = await supabase
      .from('books')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !book) return res.status(404).redirect('/books');

    const { data: similarBooks } = await supabase
      .from('books')
      .select('*')
      .eq('category', book.category)
      .neq('id', book.id);

    const similar = similarBooks ? shuffle(similarBooks).slice(0, 4) : [];

    const { data: bookChapters } = await supabase
      .from('chapters')
      .select('id, title, addedBy, addedAt')
      .eq('bookId', book.id)
      .order('id', { ascending: true });

    res.render('book-detail', { book, similar, bookChapters: bookChapters || [] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

app.get('/read/:slug', async (req, res) => {
  res.locals.page = 'read';
  try {
    const { data: book, error } = await supabase
      .from('books')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !book) return res.status(404).redirect('/books');

    // Increment reads asynchronously (fire & forget is fine)
    supabase
      .from('books')
      .update({ reads: (book.reads || 0) + 1 })
      .eq('id', book.id)
      .then(() => {});

    const { data: bookChapters } = await supabase
      .from('chapters')
      .select('*')
      .eq('bookId', book.id)
      .order('id', { ascending: true });

    res.render('read', { book, bookChapters: bookChapters || [] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

// ===== AUTH =====
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.locals.page = 'auth';
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', hashPassword(password))
      .maybeSingle();

    if (error || !user) {
      res.locals.page = 'auth';
      return res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    req.session.userId = user.id;
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

app.get('/register', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.locals.page = 'auth';
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, password, password2 } = req.body;
  if (!username || !password) {
    res.locals.page = 'auth';
    return res.render('register', { error: 'Tüm alanları doldurun.' });
  }
  if (password !== password2) {
    res.locals.page = 'auth';
    return res.render('register', { error: 'Şifreler eşleşmiyor.' });
  }

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existingUser) {
      res.locals.page = 'auth';
      return res.render('register', { error: 'Bu kullanıcı adı zaten kullanılıyor.' });
    }

    const newUser = {
      id: generateId(),
      username,
      password: hashPassword(password),
      createdAt: new Date().toISOString()
    };

    const { error } = await supabase.from('users').insert(newUser);
    if (error) throw error;

    req.session.userId = newUser.id;
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.locals.page = 'auth';
    return res.render('register', { error: 'Kayıt işlemi başarısız: ' + e.message });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ===== PROFILE =====
app.get('/profile', requireAuth, async (req, res) => {
  res.locals.page = 'profile';
  try {
    const user = res.locals.user;
    const { data: userBooks } = await supabase
      .from('books')
      .select('*')
      .eq('addedBy', user.id);

    res.render('profile', { userBooks: userBooks || [] });
  } catch (e) {
    console.error(e);
    res.status(500).send('Profil yüklenemedi.');
  }
});

// ===== ADD BOOK PAGE =====
app.get('/add-book', requireAuth, (req, res) => {
  res.locals.page = 'add-book';
  res.render('add-book', { error: null });
});

// ===== PARSE BOOK (AJAX) =====
app.post('/add-book/parse', requireAuth, upload.single('bookFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Lütfen bir PDF veya EPUB dosyası seçin.' });
    }

    const { extractBook } = require('./lib/extract');
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    
    // Parse directly from memory buffer
    const parsed = await extractBook(req.file.buffer, ext);

    // Upload to Supabase Storage
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('books')
      .upload(uniqueName, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('books')
      .getPublicUrl(uniqueName);

    const titleFallback = path.basename(req.file.originalname, path.extname(req.file.originalname))
      .replace(/[-_]/g, ' ')
      .trim();

    res.json({
      success: true,
      metadata: {
        title: parsed.metadata.title || titleFallback,
        author: parsed.metadata.author || '',
        year: parsed.metadata.year || null,
        pages: parsed.pageCount || 0
      },
      file: {
        filename: uniqueName,
        path: publicUrl,
        type: ext
      }
    });
  } catch (err) {
    console.error("Dosya analiz hatası:", err);
    res.status(500).json({ error: 'Dosya analiz edilemedi: ' + err.message });
  }
});

// ===== SAVE BOOK =====
app.post('/add-book', requireAuth, async (req, res) => {
  const { title, author, category, year, pages, desc, color, filePath, fileType } = req.body;

  if (!title || !author || !category || !year || !filePath || !fileType) {
    res.locals.page = 'add-book';
    return res.render('add-book', { error: 'Zorunlu alanları doldurun.' });
  }

  try {
    const bookId = generateId();
    const bookSlug = slugify(title);

    const newBook = {
      id: bookId,
      slug: bookSlug,
      title: title.trim(),
      author: author.trim(),
      category: category.trim(),
      rating: 0,
      reads: 0,
      downloads: 0,
      year: parseInt(year),
      pages: parseInt(pages) || 0,
      desc: (desc || '').trim(),
      chapters: [],
      color: (color || '#6b8cce').trim(),
      addedBy: req.session.userId,
      pdfFile: fileType === 'pdf' ? filePath : null,
      epubFile: fileType === 'epub' ? filePath : null
    };

    // Check slug collision
    const { data: existingBook } = await supabase
      .from('books')
      .select('id')
      .eq('slug', newBook.slug)
      .maybeSingle();

    if (existingBook) {
      newBook.slug = `${newBook.slug}-${newBook.id}`;
    }

    // Download file buffer from Supabase Storage to parse chapters
    const uniqueName = path.basename(filePath);
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('books')
      .download(uniqueName);

    if (downloadError) throw downloadError;
    const buffer = Buffer.from(await fileBlob.arrayBuffer());

    const { extractBook } = require('./lib/extract');
    const parsed = await extractBook(buffer, fileType);

    const bookChapters = (parsed.pages || []).map((pageText, index) => ({
      id: generateId() + index,
      bookId: bookId,
      title: `Sayfa ${index + 1}`,
      content: pageText,
      addedBy: req.session.userId,
      addedAt: new Date().toISOString()
    }));

    newBook.chapters = bookChapters.map(c => c.title);
    newBook.pages = bookChapters.length || newBook.pages;

    // Insert Book
    const { error: bookInsertError } = await supabase
      .from('books')
      .insert(newBook);

    if (bookInsertError) throw bookInsertError;

    // Insert Chapters bulk
    if (bookChapters.length > 0) {
      const { error: chaptersInsertError } = await supabase
        .from('chapters')
        .insert(bookChapters);

      if (chaptersInsertError) throw chaptersInsertError;
    }

    res.redirect(`/book/${newBook.slug}`);
  } catch (err) {
    console.error("Kitap ekleme hatası:", err);
    res.locals.page = 'add-book';
    return res.render('add-book', { error: 'Kitap eklenirken bir hata oluştu: ' + err.message });
  }
});

// ===== DELETE BOOK =====
app.post('/book/:slug/delete', requireAuth, async (req, res) => {
  try {
    const { data: book, error } = await supabase
      .from('books')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !book) return res.status(404).send('Kitap bulunamadı.');

    if (book.addedBy && book.addedBy !== req.session.userId) {
      return res.status(403).send('Bu kitabı silmeye yetkiniz yok.');
    }

    // Delete from Supabase Storage
    const fileUrl = book.pdfFile || book.epubFile;
    if (fileUrl) {
      const filename = path.basename(fileUrl);
      await supabase.storage.from('books').remove([filename]);
    }

    // Delete chapters explicitly (cascade also handles)
    await supabase.from('chapters').delete().eq('bookId', book.id);

    // Delete book record
    const { error: deleteError } = await supabase.from('books').delete().eq('id', book.id);
    if (deleteError) throw deleteError;

    res.redirect('/profile');
  } catch (err) {
    console.error("Kitap silme hatası:", err);
    res.status(500).send('Kitap silinirken bir hata oluştu: ' + err.message);
  }
});

// ===== ADD CHAPTER =====
app.post('/book/:slug/add-chapter', requireAuth, async (req, res) => {
  try {
    const { data: book, error } = await supabase
      .from('books')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !book) return res.status(404).redirect('/books');

    const { chapterTitle, chapterContent } = req.body;
    if (!chapterTitle || !chapterContent) {
      return res.redirect(`/book/${book.slug}`);
    }

    const newChapter = {
      id: generateId(),
      bookId: book.id,
      title: chapterTitle.trim(),
      content: chapterContent.trim(),
      addedBy: req.session.userId,
      addedAt: new Date().toISOString()
    };

    const { error: insertError } = await supabase.from('chapters').insert(newChapter);
    if (insertError) throw insertError;

    const currentChapters = book.chapters || [];
    currentChapters.push(chapterTitle.trim());

    await supabase.from('books').update({ chapters: currentChapters }).eq('id', book.id);

    res.redirect(`/book/${book.slug}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Bölüm eklenemedi.');
  }
});

// ===== DOWNLOADS =====
app.get('/download/:slug/:format', async (req, res) => {
  try {
    const { data: book, error } = await supabase
      .from('books')
      .select('*')
      .eq('slug', req.params.slug)
      .single();

    if (error || !book) return res.status(404).send('Kitap bulunamadı.');

    const format = req.params.format;
    const fileField = format === 'pdf' ? 'pdfFile' : 'epubFile';

    if (book[fileField]) {
      // Increment downloads asynchronously
      supabase
        .from('books')
        .update({ downloads: (book.downloads || 0) + 1 })
        .eq('id', book.id)
        .then(() => {});
        
      // Redirect directly to Supabase storage URL to download the file
      return res.redirect(book[fileField]);
    }

    // Fallback: generate text from chapters
    const { data: bookChapters } = await supabase
      .from('chapters')
      .select('*')
      .eq('bookId', book.id)
      .order('id', { ascending: true });

    let content = `${book.title}\n${book.author}\n\n${book.desc}\n\n`;
    if (bookChapters && bookChapters.length) {
      bookChapters.forEach((ch, i) => {
        content += `\n--- ${ch.title} ---\n\n${ch.content}\n\n`;
      });
    } else {
      content += '\n[Henüz bölüm içeriği eklenmemiş.]\n';
    }

    const filename = `${book.slug}.txt`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain');
    res.send(content);
  } catch (e) {
    console.error(e);
    res.status(500).send('Sunucu hatası.');
  }
});

// ===== API =====
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json([]);
  try {
    const { data: results } = await supabase
      .from('books')
      .select('*')
      .or(`title.ilike.%${q}%,author.ilike.%${q}%`)
      .limit(8);

    res.json(results || []);
  } catch (e) {
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`RomanOku çalışıyor: http://localhost:${PORT}`);
});
