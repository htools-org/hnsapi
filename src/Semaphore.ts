export interface SemaphoreItem {
  resolve: (val: any) => void
  reject: (err: any) => void
  cb: () => Promise<unknown>
  next: SemaphoreItem | null
}

export class Semaphore {
  private readonly tickets: number;

  private currentReqs: SemaphoreItem | null = null;

  private activeReqs: number = 0;

  constructor (tickets: number) {
    this.tickets = tickets;
  }

  take<T> (cb: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: SemaphoreItem = {
        resolve,
        reject,
        cb,
        next: null
      };
      if (this.currentReqs) {
        this.currentReqs.next = item;
      } else {
        this.currentReqs = item;
      }
      this.next();
    });
  }

  private next () {
    if (!this.currentReqs) {
      return;
    }

    if (this.activeReqs >= this.tickets) {
      return;
    }

    this.activeReqs++;
    const item = this.currentReqs;
    this.currentReqs = item.next;
    item.cb().then((res) => item.resolve(res))
      .catch((err) => item.reject(err))
      .finally(() => {
        this.activeReqs--;
        this.next();
      });
  }
}