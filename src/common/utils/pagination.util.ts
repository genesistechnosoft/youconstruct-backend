export function paginate(page = 1, limit = 20) {
  const currentPage = Math.max(page, 1);
  const take = Math.min(Math.max(limit, 1), 100);

  return { skip: (currentPage - 1) * take, take };
}

export function paginationMeta(page: number, limit: number, total: number) {
  const currentPage = Math.max(page, 1);
  const currentLimit = Math.min(Math.max(limit, 1), 100);

  return {
    page: currentPage,
    limit: currentLimit,
    total,
    totalPages: Math.ceil(total / currentLimit) || 0,
  };
}
