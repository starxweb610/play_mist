/**
 * controllers/sitehandler/builderTemplatesController.js
 * Admin catalogue for the developer Game Builder.
 *
 * Categories (2D, 3D…) group template ZIPs. A template is validated the moment
 * it is uploaded — an admin finds out here that a zip is missing index.html,
 * rather than a developer finding out when their workspace comes out empty.
 * The archive itself goes to R2; the local temp copy is always removed.
 */
const fse    = require('fs-extra');
const db     = require('../../config/database');
const r2     = require('../../config/r2');
const zipper = require('../../utils/builderZip');
const { slugBase } = require('../../utils/slugs');
const { BuilderError } = require('../../utils/builderFs');

const PAGE = '/sitehandler/builder-templates';

/** Drops whatever multer staged, whichever way the request ends. */
const discard = (file) => { if (file?.path) fse.remove(file.path).catch(() => {}); };

const fail = (req, res, message, to = PAGE) => {
  req.flash('error_msg', message);
  return res.redirect(to);
};

/** First free slug in a scope, mirroring utils/slugs.uniqueSlug. */
async function freeSlug(table, base, { scopeColumn = null, scopeValue = null, excludeId = null } = {}) {
  const root = slugBase(base, 'item');
  let slug = root;
  let n = 1;
  while (n < 200) {
    const where  = [`slug = ?`];
    const params = [slug];
    if (scopeColumn) { where.push(`${scopeColumn} = ?`); params.push(scopeValue); }
    if (excludeId)   { where.push('id <> ?');            params.push(excludeId); }
    const [rows] = await db.query(`SELECT id FROM ${table} WHERE ${where.join(' AND ')}`, params);
    if (!rows.length) return slug;
    slug = `${root}-${++n}`;
  }
  return `${root}-${Date.now()}`;
}

// ── GET /sitehandler/builder-templates ───────────────────────────────────────
exports.getIndex = async (req, res) => {
  try {
    const [categories] = await db.query(
      `SELECT c.*, COUNT(t.id) AS template_count
         FROM builder_template_categories c
         LEFT JOIN builder_templates t ON t.category_id = c.id
        GROUP BY c.id
        ORDER BY c.position ASC, c.name ASC`
    );
    const [templates] = await db.query(
      `SELECT t.*, c.name AS category_name
         FROM builder_templates t
         JOIN builder_template_categories c ON c.id = t.category_id
        ORDER BY c.position ASC, c.name ASC, t.name ASC`
    );

    // How many workspaces are building on each template, so an admin can see
    // what a delete would cut loose before they click it.
    const [usage] = await db.query(
      `SELECT template_id, COUNT(*) AS live
         FROM developer_builder_workspaces
        WHERE template_id IS NOT NULL
        GROUP BY template_id`
    );
    const liveByTemplate = new Map(usage.map((row) => [row.template_id, row.live]));
    for (const template of templates) template.live_workspaces = liveByTemplate.get(template.id) || 0;

    res.render('sitehandler/builder-templates/index', {
      title: 'Game Builder Templates',
      activePage: 'builder-templates',
      categories,
      templates,
      maxZipMb: Math.round(zipper.MAX_ZIP_BYTES / (1024 * 1024)),
    });
  } catch (err) {
    return fail(req, res, 'Failed to load builder templates: ' + err.message, '/sitehandler/dashboard');
  }
};

// ── Categories ───────────────────────────────────────────────────────────────

exports.postCreateCategory = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const position = Number.parseInt(req.body.position, 10) || 0;

  if (!name) return fail(req, res, 'Category name is required.');
  if (name.length > 100) return fail(req, res, 'Category name must be 100 characters or fewer.');

  try {
    const [existing] = await db.query(
      'SELECT id FROM builder_template_categories WHERE LOWER(name) = LOWER(?)', [name]
    );
    if (existing.length) return fail(req, res, `A category called "${name}" already exists.`);

    const slug = await freeSlug('builder_template_categories', name);
    await db.query(
      `INSERT INTO builder_template_categories (name, slug, description, position) VALUES (?, ?, ?, ?)`,
      [name, slug, description, position]
    );
    req.flash('success_msg', `Category "${name}" created.`);
    res.redirect(PAGE);
  } catch (err) {
    return fail(req, res, 'Failed to create category: ' + err.message);
  }
};

exports.postUpdateCategory = async (req, res) => {
  const { id } = req.params;
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const position = Number.parseInt(req.body.position, 10) || 0;
  const isActive = req.body.is_active === 'on' || req.body.is_active === '1' ? 1 : 0;

  if (!name) return fail(req, res, 'Category name is required.');

  try {
    const [rows] = await db.query('SELECT id FROM builder_template_categories WHERE id = ?', [id]);
    if (!rows.length) return fail(req, res, 'Category not found.');

    const [clash] = await db.query(
      'SELECT id FROM builder_template_categories WHERE LOWER(name) = LOWER(?) AND id <> ?', [name, id]
    );
    if (clash.length) return fail(req, res, `Another category is already called "${name}".`);

    // The slug is left alone on rename, the way developer-facing slugs are —
    // a template's workspace folder was never named from it, but keeping the
    // rule uniform avoids surprises if it ever reaches a URL.
    await db.query(
      `UPDATE builder_template_categories SET name = ?, description = ?, position = ?, is_active = ? WHERE id = ?`,
      [name, description, position, isActive, id]
    );
    req.flash('success_msg', 'Category updated.');
    res.redirect(PAGE);
  } catch (err) {
    return fail(req, res, 'Failed to update category: ' + err.message);
  }
};

exports.postDeleteCategory = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT name FROM builder_template_categories WHERE id = ?', [id]);
    if (!rows.length) return fail(req, res, 'Category not found.');

    // Every template under it goes too (ON DELETE CASCADE), so their archives
    // must be removed from R2 first — the rows that name those keys are about
    // to disappear.
    const [templates] = await db.query('SELECT r2_key FROM builder_templates WHERE category_id = ?', [id]);
    await db.query('DELETE FROM builder_template_categories WHERE id = ?', [id]);
    for (const template of templates) {
      await r2.deleteObject(template.r2_key).catch(() => {});
    }

    req.flash('success_msg',
      `Category "${rows[0].name}" deleted${templates.length ? ` along with ${templates.length} template(s)` : ''}. ` +
      'Developers already building on them keep their files.');
    res.redirect(PAGE);
  } catch (err) {
    return fail(req, res, 'Failed to delete category: ' + err.message);
  }
};

// ── Templates ────────────────────────────────────────────────────────────────

exports.postCreateTemplate = async (req, res) => {
  const file = req.file || null;
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const categoryId = Number.parseInt(req.body.category_id, 10);

  const bail = (message) => { discard(file); return fail(req, res, message); };

  // multer's own rejection (oversized, not a zip) is reported before anything
  // else — the rest of the form cannot be judged without the archive.
  if (req.uploadError) return bail(req.uploadError);
  if (!name) return bail('Template name is required.');
  if (name.length > 200) return bail('Template name must be 200 characters or fewer.');
  if (!Number.isInteger(categoryId)) return bail('Pick a category for this template.');
  if (!file) return bail('A template ZIP is required.');

  try {
    const [categories] = await db.query(
      'SELECT id, name FROM builder_template_categories WHERE id = ?', [categoryId]
    );
    if (!categories.length) return bail('That category no longer exists.');

    const [clash] = await db.query(
      'SELECT id FROM builder_templates WHERE category_id = ? AND LOWER(name) = LOWER(?)', [categoryId, name]
    );
    if (clash.length) return bail(`"${categories[0].name}" already has a template called "${name}".`);

    // Validate before the upload: a bad archive must never reach R2, where it
    // would cost storage and could still be handed to a developer if the row
    // were written.
    let stats;
    try {
      stats = zipper.validate(file.path);
    } catch (err) {
      return bail(err instanceof BuilderError ? err.message : 'That ZIP could not be read.');
    }

    const slug  = await freeSlug('builder_templates', name, { scopeColumn: 'category_id', scopeValue: categoryId });
    const r2Key = `builder-templates/${categoryId}/${Date.now()}-${slug}.zip`;
    await r2.uploadFile(r2Key, file.path, 'application/zip');

    try {
      await db.query(
        `INSERT INTO builder_templates (category_id, name, slug, description, r2_key, file_count, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [categoryId, name, slug, description, r2Key, stats.fileCount, stats.totalBytes]
      );
    } catch (err) {
      // The object is already in R2 but nothing references it — drop it rather
      // than leaving an orphan no page can ever show or delete.
      await r2.deleteObject(r2Key).catch(() => {});
      throw err;
    }

    discard(file);
    req.flash('success_msg', `Template "${name}" uploaded — ${stats.fileCount} file(s).`);
    res.redirect(PAGE);
  } catch (err) {
    return bail('Failed to upload template: ' + err.message);
  }
};

exports.postUpdateTemplate = async (req, res) => {
  const { id } = req.params;
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim() || null;
  const categoryId = Number.parseInt(req.body.category_id, 10);
  const isActive = req.body.is_active === 'on' || req.body.is_active === '1' ? 1 : 0;

  if (!name) return fail(req, res, 'Template name is required.');
  if (!Number.isInteger(categoryId)) return fail(req, res, 'Pick a category for this template.');

  try {
    const [rows] = await db.query('SELECT id, category_id FROM builder_templates WHERE id = ?', [id]);
    if (!rows.length) return fail(req, res, 'Template not found.');

    const [categories] = await db.query('SELECT id FROM builder_template_categories WHERE id = ?', [categoryId]);
    if (!categories.length) return fail(req, res, 'That category no longer exists.');

    const [clash] = await db.query(
      'SELECT id FROM builder_templates WHERE category_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
      [categoryId, name, id]
    );
    if (clash.length) return fail(req, res, `That category already has a template called "${name}".`);

    // Moving a template between categories can collide with a sibling slug,
    // since the unique key is (category_id, slug) — reissue it in the new home.
    const slug = await freeSlug('builder_templates', name, {
      scopeColumn: 'category_id', scopeValue: categoryId, excludeId: Number(id),
    });

    await db.query(
      `UPDATE builder_templates SET category_id = ?, name = ?, slug = ?, description = ?, is_active = ? WHERE id = ?`,
      [categoryId, name, slug, description, isActive, id]
    );
    req.flash('success_msg', 'Template updated.');
    res.redirect(PAGE);
  } catch (err) {
    return fail(req, res, 'Failed to update template: ' + err.message);
  }
};

/** Replaces the archive behind an existing template, keeping its row and name. */
exports.postReplaceTemplateZip = async (req, res) => {
  const { id } = req.params;
  const file = req.file || null;
  const bail = (message) => { discard(file); return fail(req, res, message); };

  if (req.uploadError) return bail(req.uploadError);
  if (!file) return bail('Choose a ZIP to upload.');

  try {
    const [rows] = await db.query('SELECT id, name, r2_key, category_id, slug FROM builder_templates WHERE id = ?', [id]);
    if (!rows.length) return bail('Template not found.');
    const template = rows[0];

    let stats;
    try {
      stats = zipper.validate(file.path);
    } catch (err) {
      return bail(err instanceof BuilderError ? err.message : 'That ZIP could not be read.');
    }

    // A fresh key rather than an overwrite: R2 is read by key, and reusing one
    // would leave any in-flight extraction reading half the old archive.
    const newKey = `builder-templates/${template.category_id}/${Date.now()}-${template.slug}.zip`;
    await r2.uploadFile(newKey, file.path, 'application/zip');

    await db.query(
      'UPDATE builder_templates SET r2_key = ?, file_count = ?, size_bytes = ? WHERE id = ?',
      [newKey, stats.fileCount, stats.totalBytes, id]
    );
    if (template.r2_key && template.r2_key !== newKey) {
      await r2.deleteObject(template.r2_key).catch(() => {});
    }

    discard(file);
    req.flash('success_msg',
      `"${template.name}" replaced — ${stats.fileCount} file(s). Existing workspaces are untouched.`);
    res.redirect(PAGE);
  } catch (err) {
    return bail('Failed to replace template: ' + err.message);
  }
};

exports.postDeleteTemplate = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT name, r2_key FROM builder_templates WHERE id = ?', [id]);
    if (!rows.length) return fail(req, res, 'Template not found.');

    // template_id is ON DELETE SET NULL, so workspaces survive with their
    // snapshot name intact — a developer mid-build loses nothing.
    await db.query('DELETE FROM builder_templates WHERE id = ?', [id]);
    await r2.deleteObject(rows[0].r2_key).catch(() => {});

    req.flash('success_msg', `Template "${rows[0].name}" deleted. Developers already using it keep their files.`);
    res.redirect(PAGE);
  } catch (err) {
    return fail(req, res, 'Failed to delete template: ' + err.message);
  }
};
