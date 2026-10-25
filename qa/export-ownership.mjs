// QA-only model of buffer publication, not an encoder or native resource adapter.
// Each run receives a fresh port. Publication is synchronous and cannot be undone.
export function createPublicationModel(publish, {
  setTimer = callback => setInterval(callback, 100), clearTimer = clearInterval,
} = {}) {
  if (typeof publish !== 'function') throw new TypeError('publish must be synchronous.');
  let current = null;

  function stopTimer(job) {
    if (!job.timerActive) return;
    job.timerActive = false;
    try { clearTimer(job.timer); }
    catch (error) { job.cleanupErrors.push(error); }
  }

  function cancel() {
    const job = current;
    if (!job) return;
    job.cancelled = true;
    current = null;
    stopTimer(job);
    // Finalization may be uninterruptible. Invalidating ownership still prevents dispatch.
    if (job.phase !== 'finalizing' && !job.cancelPromise) {
      job.cancelPromise = Promise.resolve().then(() => job.port.cancel());
      job.cancelPromise.catch(() => {}); // Cleanup below observes this rejection.
    }
  }

  async function run(port, { signal } = {}) {
    if (current) throw new Error('A current transaction is already running.');
    const job = { port, cancelled: false, phase: 'preparing', timerActive: false,
      cancelPromise: null, disposed: false, cleanupErrors: [], listenerActive: false };
    current = job;
    let primaryError, hasPrimaryError = false;
    const owns = () => current === job && !job.cancelled;
    const onAbort = () => { if (current === job) cancel(); };
    function removeListener() {
      if (!job.listenerActive) return;
      job.listenerActive = false;
      try { signal.removeEventListener('abort', onAbort); }
      catch (error) { job.cleanupErrors.push(error); }
    }
    try {
      job.listenerActive = !!signal;
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) cancel();
      if (!owns()) return { status: 'cancelled', published: false };
      // This interval exercises resource cleanup only; it does not collect metrics.
      job.timer = setTimer(() => {});
      job.timerActive = true;
      if (!owns()) return { status: 'cancelled', published: false };
      await port.start();
      if (!owns()) return { status: 'cancelled', published: false };
      job.phase = 'adding';
      await port.addFrames(owns);
      if (!owns()) return { status: 'cancelled', published: false };
      job.phase = 'finalizing';
      await port.finalize();
      if (!owns()) return { status: 'cancelled', published: false };
      const buffer = port.buffer;
      stopTimer(job);
      job.disposed = true;
      await port.dispose();
      removeListener();
      if (!owns()) return { status: 'cancelled', published: false };
      // A timer cleanup failure must also prevent publication; finally reports it.
      if (job.cleanupErrors.length) return { status: 'failed', published: false };
      publish(buffer);
      return { status: 'completed', published: true };
    } catch (error) {
      hasPrimaryError = true;
      primaryError = error;
      if (owns()) cancel();
      throw error; // Even an abort must not hide an independent stage failure.
    } finally {
      stopTimer(job);
      removeListener();
      try { await job.cancelPromise; }
      catch (error) { job.cleanupErrors.push(error); }
      try { if (!job.disposed) { job.disposed = true; await port.dispose(); } }
      catch (error) { job.cleanupErrors.push(error); }
      finally { if (current === job) current = null; }
      if (job.cleanupErrors.length) {
        if (hasPrimaryError) throw new AggregateError([primaryError, ...job.cleanupErrors],
          'Transaction and cleanup failed.', { cause: primaryError });
        if (job.cleanupErrors.length === 1) throw job.cleanupErrors[0];
        throw new AggregateError(job.cleanupErrors, 'Transaction cleanup failed.');
      }
    }
  }

  return { run, cancel };
}
