// backend/src/config/upload.js
//
// Single source of truth for file uploads. Previously the multer storage
// configuration was copy-pasted in userRoutes, bookingRoutes and
// customerRoutes (three near-identical blocks) which made the upload
// directory handling inconsistent. All uploads now share:
//   * the same destination (created on boot, so the container/first run works),
//   * the same 5 MB limit,
//   * the same mime-type whitelist behaviour.

const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Default to <repo>/server/uploads, overridable for Docker/volume mounts.
const uploadsDir = path.resolve(
    process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads')
);

// multer fails with ENOENT if the destination does not exist yet.
fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const imageOnly = (file) => file.mimetype.startsWith('image/');
const imageOrPdf = (file) =>
    file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf';

/**
 * Build a multer instance for a specific upload purpose.
 * @param {object} options
 * @param {string} options.prefix suffix added to the generated filename
 * @param {(file: Express.Multer.File) => boolean} options.allowed mime whitelist
 * @param {string} options.rejectionMessage error surfaced when a file is rejected
 */
const createUploader = ({ prefix = 'file', allowed = imageOrPdf, rejectionMessage }) => {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadsDir),
        filename: (req, file, cb) => {
            // auth middleware runs before the upload middleware on every route
            // that uses this, so req.user is normally present.
            const userId = req.user?.id || 'public';
            const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
            cb(null, `${userId}-${Date.now()}-${prefix}${ext}`);
        },
    });

    return multer({
        storage,
        limits: { fileSize: MAX_FILE_SIZE_BYTES },
        fileFilter: (req, file, cb) => {
            if (allowed(file)) return cb(null, true);
            const error = new Error(
                rejectionMessage || 'Only images and PDF files are allowed!'
            );
            error.statusCode = 400;
            cb(error);
        },
    });
};

module.exports = { uploadsDir, createUploader, imageOnly, imageOrPdf, MAX_FILE_SIZE_BYTES };
