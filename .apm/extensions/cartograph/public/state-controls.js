export function createStateControls({ field, initial, normalize, isValid }, send, onChange) {
  let confirmed = normalize(initial);
  let desired = confirmed;
  let serverRevision = null;
  let sending = false;
  let intentRevision = 0;

  function accept(value, revision, acknowledgement = false) {
    if (!isValid(value)) return;
    if (Number.isSafeInteger(revision) && revision >= 0) {
      if (serverRevision !== null && revision <= serverRevision) return;
      serverRevision = revision;
    } else {
      // Legacy snapshots cannot be ordered; protect pending intent, then
      // resume idle synchronisation. Never downgrade a versioned connection.
      if (serverRevision !== null || (sending && !acknowledgement)) return;
    }
    confirmed = normalize(value);
  }

  async function flush() {
    if (sending) return;
    sending = true;
    for (;;) {
      const sent = normalize(desired);
      const sentRevision = intentRevision;
      let error = null;
      try {
        const next = await send(sent);
        if (!isValid(next?.[field])) throw new Error(`Missing ${field} confirmation`);
        accept(next[field], next[`${field}Revision`], true);
      } catch (cause) {
        error = `Could not save ${field}: ${cause?.message || String(cause)}.`;
      }
      if (intentRevision === sentRevision) {
        desired = confirmed;
        sending = false;
        onChange(normalize(desired), {
          pending: false,
          error: error ? `${error} Last confirmed view restored; try again.` : null,
        });
        return;
      }
      onChange(normalize(desired), { pending: true, error });
    }
  }

  return {
    get revision() { return serverRevision; },
    get value() { return normalize(desired); },
    reconcile(transform = (value) => value) {
      const nextDesired = normalize(transform(desired));
      if (sending && JSON.stringify(nextDesired) !== JSON.stringify(desired)) intentRevision++;
      confirmed = normalize(transform(confirmed));
      desired = nextDesired;
    },
    snapshot(value, revision) {
      accept(value, revision);
      if (!sending) desired = confirmed;
      return normalize(desired);
    },
    update(transform) {
      desired = normalize(transform(desired));
      intentRevision++;
      onChange(normalize(desired), { pending: true, error: null });
      void flush();
    },
  };
}
