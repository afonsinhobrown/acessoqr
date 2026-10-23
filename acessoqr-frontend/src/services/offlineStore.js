// Offline Transaction Store for Vendor POS Terminals

const OFFLINE_QUEUE_KEY = 'acessoqr_offline_queue_v1';

export const offlineStore = {
  getQueue() {
    try {
      const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  enqueue(sale) {
    const queue = this.getQueue();
    queue.push({
      ...sale,
      queuedAt: new Date().toISOString(),
      status: 'pending'
    });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    return queue.length;
  },

  async syncAll(apiInstance) {
    const queue = this.getQueue();
    if (!queue.length) return { synced: 0, rejected: 0 };

    let synced = 0;
    let rejected = 0;
    const remaining = [];

    for (const item of queue) {
      try {
        await apiInstance.posSale({
          deviceId: item.deviceId,
          sellerId: item.sellerId,
          qrToken: item.qrToken,
          valor: item.valor,
          clientTxId: item.clientTxId,
          itemsDesc: item.itemsDesc + ' [Offline Sync]'
        });
        synced++;
      } catch (err) {
        console.error('Failed to sync offline item', item, err);
        rejected++;
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    return { synced, rejected };
  },

  count() {
    return this.getQueue().length;
  },

  clear() {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  }
};
