const fs = require('fs');
const path = require('path');
const { supabase } = require('./lib/supabase');

async function runSeed() {
  console.log('Veri tohumlama (seeding) başlatıldı...');

  // 1. Kullanıcıları Tohumla
  const usersPath = path.join(__dirname, 'data', 'users.json');
  if (fs.existsSync(usersPath)) {
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    if (users.length > 0) {
      console.log(`${users.length} adet kullanıcı ekleniyor...`);
      const { error: userError } = await supabase.from('users').insert(users);
      if (userError) console.error('Kullanıcı ekleme hatası:', userError);
      else console.log('Kullanıcılar başarıyla eklendi.');
    }
  }

  // 2. Kitapları Tohumla
  const booksPath = path.join(__dirname, 'data', 'books.json');
  if (fs.existsSync(booksPath)) {
    const books = JSON.parse(fs.readFileSync(booksPath, 'utf8'));
    if (books.length > 0) {
      console.log(`${books.length} adet kitap ekleniyor...`);
      const mappedBooks = books.map(b => ({
        id: b.id,
        slug: b.slug,
        title: b.title,
        author: b.author,
        category: b.category,
        rating: b.rating || 0,
        reads: b.reads || 0,
        downloads: b.downloads || 0,
        year: b.year,
        pages: b.pages,
        desc: b.desc,
        chapters: b.chapters || [],
        color: b.color || '#6b8cce',
        addedBy: b.addedBy || null,
        pdfFile: b.pdfFile || null,
        epubFile: b.epubFile || null
      }));
      const { error: bookError } = await supabase.from('books').insert(mappedBooks);
      if (bookError) console.error('Kitap ekleme hatası:', bookError);
      else console.log('Kitaplar başarıyla eklendi.');
    }
  }

  // 3. Bölümleri Tohumla
  const chaptersPath = path.join(__dirname, 'data', 'chapters.json');
  if (fs.existsSync(chaptersPath)) {
    const chaptersMap = JSON.parse(fs.readFileSync(chaptersPath, 'utf8'));
    const chaptersList = [];
    for (const bookId in chaptersMap) {
      const chs = chaptersMap[bookId] || [];
      chs.forEach(c => {
        chaptersList.push({
          id: c.id,
          bookId: parseInt(bookId),
          title: c.title,
          content: c.content,
          addedBy: c.addedBy || null,
          addedAt: c.addedAt || new Date().toISOString()
        });
      });
    }

    if (chaptersList.length > 0) {
      console.log(`${chaptersList.length} adet bölüm ekleniyor...`);
      const { error: chapterError } = await supabase.from('chapters').insert(chaptersList);
      if (chapterError) console.error('Bölüm ekleme hatası:', chapterError);
      else console.log('Bölümler başarıyla eklendi.');
    }
  }

  console.log('Tohumlama işlemi tamamlandı!');
}

runSeed().catch(console.error);
