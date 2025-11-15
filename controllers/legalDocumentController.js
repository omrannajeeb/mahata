import asyncHandler from 'express-async-handler';
import LegalDocument from '../models/LegalDocument.js';

// GET /api/legal-documents/:slug
export const getLegalDocument = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const doc = await LegalDocument.findOne({ slug }).lean();
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  res.json(doc);
});

// PUT /api/legal-documents/:slug { title, content, format }
export const upsertLegalDocument = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { title, content, format } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ message: 'title and content required' });
  }
  if (format && !['markdown', 'html'].includes(format)) {
    return res.status(400).json({ message: 'Invalid format' });
  }
  let doc = await LegalDocument.findOne({ slug });
  if (!doc) {
    doc = await LegalDocument.create({ slug, title, content, format: format || 'markdown', updatedBy: req.user?._id });
  } else {
    doc.title = title;
    doc.content = content;
    if (format) doc.format = format;
    if (req.user?._id) doc.updatedBy = req.user._id;
    await doc.save();
  }
  res.json(await LegalDocument.findById(doc._id).lean());
});

// GET /api/legal-documents (admin list)
export const listLegalDocuments = asyncHandler(async (req, res) => {
  const docs = await LegalDocument.find({}).sort({ slug: 1 }).lean();
  res.json(docs);
});

// DELETE /api/legal-documents/:slug
export const deleteLegalDocument = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const doc = await LegalDocument.findOne({ slug });
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  await doc.deleteOne();
  res.json({ ok: true, deleted: slug });
});
