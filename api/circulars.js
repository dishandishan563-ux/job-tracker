// GET /api/circulars — সার্কুলার তালিকা সবসময় সার্ভার থেকে তাজা আসে।
// no-store হেডার দেওয়া আছে, তাই ব্রাউজার পুরনো ক্যাশ করা কপি দেখায় না —
// হোম পেইজের তালিকা প্রতিবার লোডে এই এন্ডপয়েন্ট থেকেই আসে (data.js দেখুন)।
// নতুন সার্কুলার data/circulars.json-এ যোগ হলেই এখান থেকে সবাইকে দেখাবে;
// admin-এর যোগ করা সার্কুলার শুধু তার নিজের ব্রাউজারে (localStorage) থাকে।
const circulars = require('../data/circulars.json');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    ok: true,
    count: circulars.length,
    updatedAt: new Date().toISOString(),
    circulars,
  });
};
