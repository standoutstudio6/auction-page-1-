
/**
 * Auction Site - Express server
 * Features:
 * - Admin panel at /admin with login (default: admin / changeme123)
 * - Create multiple auctions with unique slugs (/auction-name)
 * - Control start time, duration, starting bid, bid increment (min/max), and info text
 * - Dark blue theme, centered Current Bid section, product info below
 * - Live countdown on auction pages and disable/enable bidding by schedule
 * - Persist data in ./data.json
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const slugify = require('slugify');
const dayjs = require('dayjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// -------------------- Helpers --------------------
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse data.json", e);
    return null;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function initialData() {
  return {
    admin: {
      username: 'admin',
      // password: 'changeme123' (hashed at first boot)
      passwordHash: null
    },
    auctions: [
      // Sample auction for demonstration
      // {
      //   id: "xxxx",
      //   slug: "sample-auction",
      //   title: "Sample Product",
      //   description: "This is a sample auction created by default.",
      //   startsAt: ISOString,
      //   endsAt: ISOString,
      //   startingBid: 50,
      //   minIncrement: 1,
      //   maxIncrement: 100,
      //   currentBid: 50,
      //   bids: [{ amount, atISO, ip }]
      // }
    ]
  };
}

async function ensureDataFile() {
  let data = loadData();
  if (!data) {
    data = initialData();
  }

  // Ensure default admin password hash exists
  if (!data.admin || !data.admin.username) {
    data.admin = { username: 'admin', passwordHash: null };
  }
  if (!data.admin.passwordHash) {
    const hash = await bcrypt.hash('changeme123', 10);
    data.admin.passwordHash = hash;
    console.log('Initialized default admin password to "changeme123"');
  }

  // Save back to disk to ensure file exists
  saveData(data);
  return data;
}

function isLoggedIn(req) {
  return !!(req.session && req.session.authed === true);
}

function authRequired(req, res, next) {
  if (!isLoggedIn(req)) {
    return res.redirect('/admin/login');
  }
  next();
}

function clampBidIncrement(amount, minInc, maxInc) {
  if (maxInc && amount > maxInc) return maxInc;
  if (amount < minInc) return minInc;
  return amount;
}

function nowISO() {
  return new Date().toISOString();
}

function utcISOFromLocal(dateStr) {
  // accepts 'YYYY-MM-DDTHH:mm' local form and converts to ISO
  const d = new Date(dateStr);
  return d.toISOString();
}

function isActiveAuction(startsAt, endsAt) {
  const n = new Date();
  return n >= new Date(startsAt) && n < new Date(endsAt);
}

function hasStarted(startsAt) {
  return new Date() >= new Date(startsAt);
}

function hasEnded(endsAt) {
  return new Date() >= new Date(endsAt);
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// -------------------- App Setup --------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

let DATA = null;

// Initialize data
ensureDataFile().then(d => {
  DATA = d;
}).catch(err => {
  console.error("Failed to ensure data file", err);
  process.exit(1);
});

// -------------------- Public Routes --------------------
app.get('/', (req, res) => {
  // Home: list all auctions
  const auctions = DATA.auctions
    .slice()
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  res.render('home', { auctions, dayjs });
});

// Public auction page
app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (slug === 'admin') return next(); // don't clash
  const auction = DATA.auctions.find(a => a.slug === slug);
  if (!auction) {
    return res.status(404).render('notfound', { slug });
  }
  res.render('auction', { auction, dayjs });
});

// Bid API (POST)
app.post('/:slug/bid', (req, res) => {
  const slug = req.params.slug;
  const amount = parseFloat(req.body.amount);
  const auction = DATA.auctions.find(a => a.slug === slug);
  if (!auction) return res.status(404).json({ ok: false, error: 'Auction not found' });

  // Normalize increments
  const inc = amount - auction.currentBid;
  if (!hasStarted(auction.startsAt)) {
    return res.json({ ok: false, error: 'Auction has not started yet.' });
  }
  if (hasEnded(auction.endsAt)) {
    return res.json({ ok: false, error: 'Auction has ended.' });
  }
  if (isNaN(amount) || amount <= auction.currentBid) {
    return res.json({ ok: false, error: 'Bid must be greater than current bid.' });
  }

  const incClamped = clampBidIncrement(inc, auction.minIncrement, auction.maxIncrement);
  if (inc !== incClamped) {
    return res.json({ ok: false, error: `Bid increment must be between ${auction.minIncrement} and ${auction.maxIncrement}.` });
  }

  auction.currentBid = parseFloat(amount.toFixed(2));
  auction.bids.push({ amount: auction.currentBid, atISO: nowISO(), ip: req.ip });
  saveData(DATA);
  res.json({ ok: true, currentBid: auction.currentBid });
});

// Poll current bid (GET)
app.get('/:slug/status', (req, res) => {
  const slug = req.params.slug;
  const auction = DATA.auctions.find(a => a.slug === slug);
  if (!auction) return res.status(404).json({ ok: false, error: 'Auction not found' });
  res.json({
    ok: true,
    currentBid: auction.currentBid,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    active: isActiveAuction(auction.startsAt, auction.endsAt),
    hasStarted: hasStarted(auction.startsAt),
    hasEnded: hasEnded(auction.endsAt)
  });
});

// -------------------- Admin Routes --------------------
app.get('/admin', (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/admin/login');
  const auctions = DATA.auctions
    .slice()
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  res.render('admin_dashboard', { auctions, dayjs, adminUser: DATA.admin.username });
});

app.get('/admin/login', (req, res) => {
  res.render('admin_login', { error: null });
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (username !== DATA.admin.username) {
    return res.render('admin_login', { error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, DATA.admin.passwordHash);
  if (!ok) {
    return res.render('admin_login', { error: 'Invalid credentials' });
  }
  req.session.authed = true;
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

app.post('/admin/creds', authRequired, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Username and password required');
  }
  DATA.admin.username = username;
  DATA.admin.passwordHash = await bcrypt.hash(password, 10);
  saveData(DATA);
  res.redirect('/admin');
});

app.post('/admin/auction', authRequired, (req, res) => {
  let { title, slug, description, startsAtLocal, durationMinutes, startingBid, minIncrement, maxIncrement } = req.body;

  title = (title || '').trim();
  description = (description || '').trim();
  startingBid = parseFloat(startingBid || '0') || 0;
  minIncrement = parseFloat(minIncrement || '1') || 1;
  maxIncrement = parseFloat(maxIncrement || '0') || 0; // 0 means no max

  // Slug
  slug = (slug || title || '').trim();
  slug = slugify(slug, { lower: true, strict: true });
  if (!slug) slug = 'auction-' + generateId();

  // Time
  const startsAt = utcISOFromLocal(startsAtLocal);
  const endsAt = new Date(new Date(startsAt).getTime() + (parseInt(durationMinutes, 10) || 60) * 60000).toISOString();

  // Ensure unique slug
  if (DATA.auctions.some(a => a.slug === slug)) {
    slug = slug + '-' + generateId().slice(0, 4);
  }

  const auction = {
    id: generateId(),
    slug,
    title,
    description,
    startsAt,
    endsAt,
    startingBid: startingBid,
    minIncrement: minIncrement,
    maxIncrement: maxIncrement > 0 ? maxIncrement : undefined,
    currentBid: startingBid,
    bids: []
  };

  DATA.auctions.push(auction);
  saveData(DATA);
  res.redirect('/admin');
});

app.post('/admin/auction/:id/update', authRequired, (req, res) => {
  const id = req.params.id;
  const auction = DATA.auctions.find(a => a.id === id);
  if (!auction) return res.status(404).send('Not found');

  const { title, description, startsAtLocal, durationMinutes, startingBid, minIncrement, maxIncrement } = req.body;
  if (title) auction.title = title.trim();
  if (description) auction.description = description.trim();

  if (startsAtLocal && durationMinutes) {
    const startsAt = utcISOFromLocal(startsAtLocal);
    const endsAt = new Date(new Date(startsAt).getTime() + (parseInt(durationMinutes, 10) || 60) * 60000).toISOString();
    auction.startsAt = startsAt;
    auction.endsAt = endsAt;
  }

  if (startingBid) {
    const sb = parseFloat(startingBid);
    if (!isNaN(sb)) {
      auction.startingBid = sb;
      if ((auction.bids||[]).length === 0) {
        auction.currentBid = sb;
      } else if (sb > auction.currentBid) {
        // If admin raises starting bid above current bid and there are bids, current stays; else only if no bids
      }
    }
  }
  if (minIncrement) {
    const mi = parseFloat(minIncrement);
    if (!isNaN(mi) && mi > 0) auction.minIncrement = mi;
  }
  if (typeof maxIncrement !== 'undefined') {
    const mx = parseFloat(maxIncrement);
    auction.maxIncrement = (!isNaN(mx) && mx > 0) ? mx : undefined;
  }

  saveData(DATA);
  res.redirect('/admin');
});

app.post('/admin/auction/:id/delete', authRequired, (req, res) => {
  const id = req.params.id;
  DATA.auctions = DATA.auctions.filter(a => a.id !== id);
  saveData(DATA);
  res.redirect('/admin');
});

// -------------------- Views --------------------
/* Minimal EJS pages live under /views
 * - layout.ejs (base)
 * - home.ejs (list auctions)
 * - auction.ejs (auction page)
 * - admin_login.ejs (login form)
 * - admin_dashboard.ejs (admin panel)
 */

// 404 fallback for other routes
app.use((req, res) => {
  res.status(404).render('notfound', { slug: null });
});

app.listen(PORT, () => {
  console.log(`Auction site running on http://localhost:${PORT}`);
});
