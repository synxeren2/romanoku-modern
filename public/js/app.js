// RomanOku Modern App JS — Uzay Teması

// ===== Star Background =====
function createStars(container, count = 60) {
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.setProperty('--duration', (3 + Math.random() * 5) + 's');
    star.style.setProperty('--opacity', 0.2 + Math.random() * 0.8);
    star.style.animationDelay = (Math.random() * 5) + 's';
    container.appendChild(star);
  }
  // Shooting stars
  for (let i = 0; i < 2; i++) {
    const shooting = document.createElement('div');
    shooting.className = 'shooting-star';
    shooting.style.top = (10 + Math.random() * 60) + '%';
    shooting.style.animationDelay = (i * 4 + Math.random() * 4) + 's';
    container.appendChild(shooting);
  }
}

document.querySelectorAll('.stars-bg').forEach(bg => createStars(bg, 50));

// ===== Toast =====
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('active');
  setTimeout(() => toast.classList.remove('active'), duration);
}

// ===== Header Scroll =====
const header = document.querySelector('.header');
if (header) {
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 20);
  });
}

// ===== Mobile Menu =====
const menuToggle = document.getElementById('menuToggle');
const nav = document.getElementById('nav');
if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    nav.classList.toggle('active');
  });
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target) && !menuToggle.contains(e.target)) {
      nav.classList.remove('active');
    }
  });
}

// ===== Search =====
const searchToggle = document.getElementById('searchToggle');
const searchOverlay = document.getElementById('searchOverlay');
const searchInput = document.getElementById('searchInput');
const searchClose = document.getElementById('searchClose');
const searchResults = document.getElementById('searchResults');
let searchTimeout;

if (searchToggle && searchOverlay) {
  searchToggle.addEventListener('click', () => {
    searchOverlay.classList.toggle('active');
    if (searchOverlay.classList.contains('active') && searchInput) {
      setTimeout(() => searchInput.focus(), 100);
    }
  });

  if (searchClose) {
    searchClose.addEventListener('click', () => {
      searchOverlay.classList.remove('active');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchOverlay) {
      searchOverlay.classList.remove('active');
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchOverlay.classList.toggle('active');
      if (searchOverlay.classList.contains('active') && searchInput) {
        setTimeout(() => searchInput.focus(), 100);
      }
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (!q) {
        searchResults.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(() => fetchSearchResults(q), 200);
    });
  }
}

async function fetchSearchResults(q) {
  if (!searchResults) return;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderSearchResults(data);
  } catch (err) {
    searchResults.innerHTML = '<div class="empty-state-sm">Arama yapılamadı</div>';
  }
}

function renderSearchResults(books) {
  if (!books.length) {
    searchResults.innerHTML = '<div class="empty-state-sm">Sonuç bulunamadı</div>';
    return;
  }
  searchResults.innerHTML = books.map(book => `
    <a href="/book/${book.slug}" class="search-result-item">
      <div class="search-result-thumb" style="background: linear-gradient(135deg, ${book.color}, ${adjustColor(book.color, -20)})">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
      </div>
      <div class="search-result-info">
        <h4>${highlight(book.title, searchInput.value)}</h4>
        <p>${highlight(book.author, searchInput.value)} • ${book.category}</p>
      </div>
    </a>
  `).join('');
}

function highlight(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, '<mark style="background:rgba(107,140,206,0.25);color:var(--accent-bright);border-radius:2px;">$1</mark>');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x00FF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ===== Scroll Reveal =====
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

// ===== Reader Progress =====
function updateReaderProgress() {
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  if (!bar || !text) return;
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const pct = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
  bar.style.width = pct + '%';
  text.textContent = '%' + pct;
}

if (document.querySelector('.reader-body')) {
  window.addEventListener('scroll', updateReaderProgress);
  window.addEventListener('resize', updateReaderProgress);
  updateReaderProgress();
}

// ===== Settings Panel Close =====
document.addEventListener('click', (e) => {
  const panel = document.getElementById('settingsPanel');
  if (panel && !panel.contains(e.target) && !e.target.closest('[onclick="toggleSettings()"]')) {
    panel.classList.remove('active');
  }
});

// ===== Smooth Page Transitions =====
document.querySelectorAll('a[href^="/"]').forEach(link => {
  if (link.target || link.href.includes('#')) return;
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('http')) {
      document.body.style.opacity = '0';
      document.body.style.transition = 'opacity 0.2s ease';
    }
  });
});
