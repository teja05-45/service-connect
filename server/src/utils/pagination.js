// backend/src/utils/pagination.js
//
// Consistent pagination for admin listings. Every list endpoint returns
// { data, pagination: { page, limit, total, total_pages } }.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePagination = (query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) => {
    const rawPage = Number.parseInt(query.page, 10);
    const rawLimit = Number.parseInt(query.limit, 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
    const offset = (page - 1) * limit;

    return { page, limit, offset };
};

const buildPaginationMeta = (total, page, limit) => {
    const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
    const totalPages = Math.max(1, Math.ceil(safeTotal / limit));
    return {
        page,
        limit,
        total: safeTotal,
        total_pages: safeTotal === 0 ? 0 : totalPages,
        has_next: page < totalPages,
        has_previous: page > 1,
    };
};

module.exports = { parsePagination, buildPaginationMeta, DEFAULT_LIMIT, MAX_LIMIT };
