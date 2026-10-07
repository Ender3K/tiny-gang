function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "meta";
  const callback = e && e.parameter && e.parameter.callback;
  const presentationId = e && e.parameter && e.parameter.presentationId;
  const pageId = e && e.parameter && e.parameter.pageId;

  const respond = (obj) => {
    const json = JSON.stringify(obj);
    if (callback) {
      return ContentService
        .createTextOutput(`${callback}(${json})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  };

  if (!presentationId) {
    return respond({ ok: false, error: "Missing presentationId" });
  }

  try {
    if (action === "meta") {
      const pres = SlidesApp.openById(presentationId);
      const slides = pres.getSlides();
      const slidePageIds = slides.map(slide => slide.getObjectId());
      const notes = slides.map(slide => {
        const speakerNotes = slide.getNotesPage().getSpeakerNotesShape();
        return speakerNotes ? speakerNotes.getText().asString() : "";
      });
      const timing = parseSlideNoteTimings(notes);

      return respond({
        ok: true,
        presentationId,
        totalSlides: slidePageIds.length,
        slidePageIds,
        timingVersion: 1,
        slideDurations: timing.durations,
        timingWarnings: timing.warnings,
        notesRulesVersion: 1,
        slideVotingDisabled: parseSlideVotingDisabled(notes)
      });
    }

    if (action === "image") {
      if (!pageId) {
        return respond({ ok: false, error: "Missing pageId" });
      }

      const token = ScriptApp.getOAuthToken();
      const url =
        `https://docs.google.com/presentation/d/${encodeURIComponent(presentationId)}` +
        `/export/png?pageid=${encodeURIComponent(pageId)}&w=1600&h=900`;

      const res = UrlFetchApp.fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true
      });

      const code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        return respond({
          ok: false,
          error: `Slide export failed with HTTP ${code}`,
          details: res.getContentText().slice(0, 500)
        });
      }

      const blob = res.getBlob();
      const mimeType = blob.getContentType() || "image/png";
      const base64 = Utilities.base64Encode(blob.getBytes());

      return respond({
        ok: true,
        presentationId,
        pageId,
        mimeType,
        dataUrl: `data:${mimeType};base64,${base64}`
      });
    }

    return respond({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** A standalone ! disables voting on that slide only. */
function parseSlideVotingDisabled(notes) {
  const disabled = {};
  notes.forEach((note, index) => {
    if (/(?:^|\s)!(?=\s|$)/.test(String(note || ""))) disabled[index + 1] = true;
  });
  return disabled;
}

/** Resolve notes in deck order. Keys are one-based slide numbers, not page IDs. */
function parseSlideNoteTimings(notes) {
  const durations = {};
  const warnings = [];
  let rangeSeconds = null;
  let rangeStart = null;

  notes.forEach((note, index) => {
    const slide = index + 1;
    const markers = Array.from(String(note || "").matchAll(/(?:^|\s)#(?:(\d+)(<)?|>)(?=\s|$)/g));
    if (markers.length > 1) {
      warnings.push(`Slide ${slide}: use one timing marker per slide; only the first is applied.`);
    }
    const marker = markers[0];
    let seconds = rangeSeconds;

    if (marker) {
      if (marker[1] === undefined) {
        if (rangeSeconds === null) {
          warnings.push(`Slide ${slide}: #> has no matching range start.`);
        }
        // The closing slide keeps the range duration before it is cleared.
        rangeSeconds = null;
        rangeStart = null;
      } else {
        const value = Number(marker[1]);
        if (!Number.isSafeInteger(value) || value < 1 || value > 3600) {
          warnings.push(`Slide ${slide}: timing must be a whole number from 1 to 3600 seconds.`);
        } else {
          seconds = value;
          if (marker[2]) {
            if (rangeSeconds !== null) {
              warnings.push(`Slide ${slide}: this range replaces the range started on slide ${rangeStart}.`);
            }
            rangeSeconds = value;
            rangeStart = slide;
          }
        }
      }
    }

    if (seconds !== null) durations[slide] = seconds;
  });

  if (rangeSeconds !== null) {
    warnings.push(`Slide ${rangeStart}: the open timing range continues to the last slide; add #> to end it sooner.`);
  }
  return { durations, warnings };
}
