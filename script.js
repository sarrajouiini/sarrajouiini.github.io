// ---------- Thème clair / sombre ----------
const root = document.documentElement;
const themeBtn = document.getElementById('themeToggle');
try {
  const saved = localStorage.getItem('theme');
  if (saved) root.dataset.theme = saved;
} catch (e) {}
if (!root.dataset.theme) {
  root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
themeBtn.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
});

// ---------- Menu mobile ----------
const navLinks = document.getElementById('navLinks');
document.getElementById('menuBtn').addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));

// ---------- Apparition au scroll + compteurs ----------
const animateCount = el => {
  const target = +el.dataset.count, suffix = el.dataset.suffix || '';
  const start = performance.now(), dur = 1400;
  const step = now => {
    const p = Math.min((now - start) / dur, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('visible');
    e.target.querySelectorAll('[data-count]').forEach(animateCount);
    io.unobserve(e.target);
  });
}, { threshold: 0, rootMargin: '0px 0px -60px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ---------- Lien actif dans la navigation ----------
const sections = [...document.querySelectorAll('main section[id]')];
const links = [...navLinks.querySelectorAll('a')];
addEventListener('scroll', () => {
  const y = scrollY + 120;
  let current = '';
  sections.forEach(s => { if (s.offsetTop <= y) current = s.id; });
  links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + current));
}, { passive: true });

// ---------- Filtres de projets ----------
document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter;
    document.querySelectorAll('[data-cat]').forEach(card => {
      const show = f === 'all' || card.dataset.cat.split(' ').includes(f);
      card.classList.toggle('hidden', !show);
      if (show) card.classList.add('visible');
    });
  });
});

// ---------- Lightbox ----------
const lb = document.getElementById('lightbox');
const lbImg = document.getElementById('lbImg');
const lbCap = document.getElementById('lbCap');
let group = [], idx = 0;
const show = i => {
  idx = (i + group.length) % group.length;
  const fig = group[idx];
  lbImg.src = fig.dataset.full;
  lbImg.alt = fig.querySelector('img').alt;
  lbCap.textContent = fig.querySelector('figcaption').textContent;
};
document.querySelectorAll('.gallery figure').forEach(fig => {
  fig.addEventListener('click', () => {
    group = [...fig.closest('.gallery').querySelectorAll('figure')];
    show(group.indexOf(fig));
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
});
const closeLb = () => { lb.classList.remove('open'); document.body.style.overflow = ''; };
lb.querySelector('.lb-close').addEventListener('click', closeLb);
lb.querySelector('.lb-prev').addEventListener('click', e => { e.stopPropagation(); show(idx - 1); });
lb.querySelector('.lb-next').addEventListener('click', e => { e.stopPropagation(); show(idx + 1); });
lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
addEventListener('keydown', e => {
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') closeLb();
  if (e.key === 'ArrowLeft') show(idx - 1);
  if (e.key === 'ArrowRight') show(idx + 1);
});

document.getElementById('year').textContent = new Date().getFullYear();
