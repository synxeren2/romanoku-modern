const express = require('express');
const router = express.Router();
const books = require('../data/books.json');

router.get('/api/books', (req, res) => {
  res.json(books);
});

module.exports = router;
