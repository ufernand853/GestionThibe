export function canRequestStockMovement(user) {
  return Array.isArray(user?.permissions) && user.permissions.includes('stock.request');
}
