const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 3000;

// ===== STORAGE & PATH SETUP =====
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;

// Determine books upload directory (local public/books or volume books)
const uploadsDir = process.env.STORAGE_DIR 
  ? path.join(STORAGE_DIR, 'books') 
  : path.join(__dirname, 'public', 'books');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/books', express.static(uploadsDir));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'romanoku-secret-key-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Determine data directory and paths
const dataDir = process.env.STORAGE_DIR
  ? path.join(STORAGE_DIR, 'data')
  : path.join(__dirname, 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const booksPath = path.join(dataDir, 'books.json');
const usersPath = path.join(dataDir, 'users.json');
const chaptersPath = path.join(dataDir, 'chapters.json');

// Copy default seed data if it doesn't exist in the persistent storage
const defaultBooksPath = path.join(__dirname, 'data', 'books.json');
const defaultUsersPath = path.join(__dirname, 'data', 'users.json');
const defaultChaptersPath = path.join(__dirname, 'data', 'chapters.json');

if (!fs.existsSync(booksPath) && fs.existsSync(defaultBooksPath)) {
  fs.copyFileSync(defaultBooksPath, booksPath);
}
if (!fs.existsSync(usersPath) && fs.existsSync(defaultUsersPath)) {
  fs.copyFileSync(defaultUsersPath, usersPath);
}
if (!fs.existsSync(chaptersPath) && fs.existsSync(defaultChaptersPath)) {
  fs.copyFileSync(defaultChaptersPath, chaptersPath);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.epub') {
      return cb(null, true);
    }
    cb(new Error('Sadece PDF ve EPUB dosyaları yüklenebilir.'));
  }
});

function loadBooks() {
  try { return JSON.parse(fs.readFileSync(booksPath, 'utf8')); }
  catch (e) { return []; }
}

function saveBooks(books) {
  fs.writeFileSync(booksPath, JSON.stringify(books, null, 2));
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(usersPath, 'utf8')); }
  catch (e) { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
}

function loadChapters() {
  try { return JSON.parse(fs.readFileSync(chaptersPath, 'utf8')); }
  catch (e) { return {}; }
}

function saveChapters(chapters) {
  fs.writeFileSync(chaptersPath, JSON.stringify(chapters, null, 2));
}

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

let books = loadBooks();
let users = loadUsers();
let chapters = loadChapters();

if (!users.length) saveUsers([]);
if (!Object.keys(chapters).length) saveChapters({});

function updateBooks() { books = loadBooks(); }
function updateChapters() { chapters = loadChapters(); }

function shuffle(arr) { return [...arr].sort(() => 0.5 - Math.random()); }

function getCategories() {
  return [...new Set(books.map(b => b.category))].map(cat => {
    const count = books.filter(b => b.category === cat).length;
    return { name: cat, count };
  });
}

function getUser(req) {
  if (!req.session || !req.session.userId) return null;
  return users.find(u => u.id === req.session.userId);
}

// ===== MIDDLEWARE: Make auth available to all templates =====
app.use((req, res, next) => {
  const user = getUser(req);
  res.locals.user = user;
  res.locals.isLoggedIn = !!user;
  res.locals.categories = getCategories();
  next();
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/login');
}

// ===== ROUTES =====
app.get('/', (req, res) => {
  updateBooks();
  res.locals.page = 'home';
  res.render('index', {
    books,
    popular: books.slice(0, 8),
    latest: shuffle(books).slice(0, 8),
    featured: books.find(b => b.id === 9) || books[0]
  });
});

app.get('/books', (req, res) => {
  updateBooks();
  res.locals.page = 'books';
  let filtered = [...books];
  const q = req.query.q || '';
  const cat = req.query.category || '';
  const sort = req.query.sort || 'popular';

  if (q) {
    filtered = filtered.filter(b =>
      b.title.toLowerCase().includes(q.toLowerCase()) ||
      b.author.toLowerCase().includes(q.toLowerCase())
    );
  }
  if (cat) filtered = filtered.filter(b => b.category === cat);

  if (sort === 'rating') filtered.sort((a, b) => b.rating - a.rating);
  else if (sort === 'az') filtered.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
  else if (sort === 'newest') filtered.sort((a, b) => b.year - a.year);
  else filtered.sort((a, b) => b.reads - a.reads);

  res.render('books', { books: filtered, q, cat, sort });
});

app.get('/book/:slug', (req, res) => {
  updateBooks();
  updateChapters();
  res.locals.page = 'book';
  const book = books.find(b => b.slug === req.params.slug);
  if (!book) return res.status(404).redirect('/books');
  const similar = shuffle(books.filter(b => b.category === book.category && b.id !== book.id)).slice(0, 4);
  const bookChapters = chapters[book.id] || [];
  res.render('book-detail', { book, similar, bookChapters });
});

app.get('/read/:slug', (req, res) => {
  updateBooks();
  updateChapters();
  res.locals.page = 'read';
  const book = books.find(b => b.slug === req.params.slug);
  if (!book) return res.status(404).redirect('/books');
  const bookChapters = chapters[book.id] || [];
  res.render('read', { book, bookChapters });
});

// ===== AUTH =====
app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.locals.page = 'auth';
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === hashPassword(password));
  if (!user) {
    res.locals.page = 'auth';
    return res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.locals.page = 'auth';
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password, password2 } = req.body;
  if (!username || !password) {
    res.locals.page = 'auth';
    return res.render('register', { error: 'Tüm alanları doldurun.' });
  }
  if (password !== password2) {
    res.locals.page = 'auth';
    return res.render('register', { error: 'Şifreler eşleşmiyor.' });
  }
  if (users.find(u => u.username === username)) {
    res.locals.page = 'auth';
    return res.render('register', { error: 'Bu kullanıcı adı zaten kullanılıyor.' });
  }
  const newUser = {
    id: generateId(),
    username,
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers(users);
  req.session.userId = newUser.id;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ===== PROFILE =====
app.get('/profile', requireAuth, (req, res) => {
  updateBooks();
  res.locals.page = 'profile';
  const user = getUser(req);
  const userBooks = books.filter(b => b.addedBy === user.id);
  res.render('profile', { userBooks });
});

// ===== ADD BOOK =====
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
    const filename = req.file.filename;
    const filePath = req.file.path;
    
    const parsed = await extractBook(filePath, ext);
    
    // Guess title from filename as fallback
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
        filename: filename,
        path: '/books/' + filename,
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
    updateBooks();
    updateChapters();
    
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
    
    if (books.find(b => b.slug === newBook.slug)) {
      newBook.slug = `${newBook.slug}-${newBook.id}`;
    }
    
    const fullFilePath = path.join(uploadsDir, path.basename(filePath));
    const { extractBook } = require('./lib/extract');
    const parsed = await extractBook(fullFilePath, fileType);
    
    const bookChapters = (parsed.pages || []).map((pageText, index) => ({
      id: generateId() + index,
      title: `Sayfa ${index + 1}`,
      content: pageText,
      addedBy: req.session.userId,
      addedAt: new Date().toISOString()
    }));
    
    newBook.chapters = bookChapters.map(c => c.title);
    newBook.pages = bookChapters.length || newBook.pages;
    
    books.push(newBook);
    saveBooks(books);
    
    chapters[bookId] = bookChapters;
    saveChapters(chapters);
    
    res.redirect(`/book/${newBook.slug}`);
  } catch (err) {
    console.error("Kitap ekleme hatası:", err);
    res.locals.page = 'add-book';
    return res.render('add-book', { error: 'Kitap eklenirken bir hata oluştu: ' + err.message });
  }
});

// ===== DELETE BOOK =====
app.post('/book/:slug/delete', requireAuth, (req, res) => {
  try {
    updateBooks();
    updateChapters();
    
    const bookIndex = books.findIndex(b => b.slug === req.params.slug);
    if (bookIndex === -1) {
      return res.status(404).send('Kitap bulunamadı.');
    }
    
    const book = books[bookIndex];
    
    // Auth check: only owner (or if no owner, any logged in user can delete for seeded books)
    if (book.addedBy && book.addedBy !== req.session.userId) {
      return res.status(403).send('Bu kitabı silmeye yetkiniz yok.');
    }
    
    // Delete files
    if (book.pdfFile) {
      const pdfPath = path.join(uploadsDir, path.basename(book.pdfFile));
      if (fs.existsSync(pdfPath)) {
        try { fs.unlinkSync(pdfPath); } catch (e) { console.error("PDF silinemedi:", e); }
      }
    }
    if (book.epubFile) {
      const epubPath = path.join(uploadsDir, path.basename(book.epubFile));
      if (fs.existsSync(epubPath)) {
        try { fs.unlinkSync(epubPath); } catch (e) { console.error("EPUB silinemedi:", e); }
      }
    }
    
    // Remove chapters
    if (chapters[book.id]) {
      delete chapters[book.id];
      saveChapters(chapters);
    }
    
    // Remove book
    books.splice(bookIndex, 1);
    saveBooks(books);
    
    res.redirect('/profile');
  } catch (err) {
    console.error("Kitap silme hatası:", err);
    res.status(500).send('Kitap silinirken bir hata oluştu: ' + err.message);
  }
});

// ===== ADD CHAPTER =====
app.post('/book/:slug/add-chapter', requireAuth, (req, res) => {
  updateBooks();
  updateChapters();
  const book = books.find(b => b.slug === req.params.slug);
  if (!book) return res.status(404).redirect('/books');

  const { chapterTitle, chapterContent } = req.body;
  if (!chapterTitle || !chapterContent) {
    return res.redirect(`/book/${book.slug}`);
  }

  if (!chapters[book.id]) chapters[book.id] = [];
  chapters[book.id].push({
    id: generateId(),
    title: chapterTitle.trim(),
    content: chapterContent.trim(),
    addedBy: req.session.userId,
    addedAt: new Date().toISOString()
  });
  saveChapters(chapters);
  res.redirect(`/book/${book.slug}`);
});

// ===== DOWNLOADS =====
app.get('/download/:slug/:format', (req, res) => {
  updateBooks();
  const book = books.find(b => b.slug === req.params.slug);
  if (!book) return res.status(404).send('Kitap bulunamadı.');

  const format = req.params.format;
  const fileField = format === 'pdf' ? 'pdfFile' : 'epubFile';

  if (book[fileField]) {
    const filePath = path.join(uploadsDir, path.basename(book[fileField]));
    if (fs.existsSync(filePath)) {
      const filename = `${book.slug}.${format === 'epub' ? 'epub' : 'pdf'}`;
      const mimeType = format === 'epub' ? 'application/epub+zip' : 'application/pdf';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', mimeType);
      return res.sendFile(filePath);
    }
  }

  // Fallback: generate text from chapters
  updateChapters();
  const bookChapters = chapters[book.id] || [];
  let content = `${book.title}\n${book.author}\n\n${book.desc}\n\n`;
  if (bookChapters.length) {
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
});

// ===== API =====
app.get('/api/search', (req, res) => {
  updateBooks();
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.json([]);
  const results = books.filter(b =>
    b.title.toLowerCase().includes(q) ||
    b.author.toLowerCase().includes(q)
  ).slice(0, 8);
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`RomanOku çalışıyor: http://localhost:${PORT}`);
});
