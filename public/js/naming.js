// Renaming points.
//
// Every tool creates points (stops, start/end, observer/target). A point's
// name lives on the tool's own state object as `.name`; this module supplies
// one consistent way to edit it and one place that decides what to display
// when no custom name has been set.

(function () {
  // Displayed label: the user's name if they set one, otherwise the fallback
  // the tool supplies (e.g. "Stop 2").
  function labelFor(point, fallback) {
    return point && point.name ? point.name : fallback;
  }

  // Replaces an element's contents with a text input, commits on Enter/blur,
  // cancels on Escape. Inline editing beats prompt() here because it keeps the
  // map visible while you type.
  function editInline(el, currentValue, onCommit) {
    if (el.querySelector('input')) return; // already editing

    const previous = el.innerHTML;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentValue || '';
    input.maxLength = 60;

    el.innerHTML = '';
    el.appendChild(input);
    input.focus();
    input.select();

    let settled = false;

    function commit() {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      onCommit(value || null); // empty string clears back to the default label
    }

    function cancel() {
      if (settled) return;
      settled = true;
      el.innerHTML = previous;
    }

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', commit);
    // Clicking inside the input shouldn't bubble to row handlers.
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // Attaches a tooltip to a Leaflet marker showing the point's label, so names
  // are visible on the map itself and not just in the panel.
  function tagMarker(marker, text) {
    if (!marker) return;
    if (marker.getTooltip()) {
      marker.setTooltipContent(text);
    } else {
      marker.bindTooltip(text, { direction: 'top', offset: [0, -12] });
    }
  }

  // Renders a "Start / End / Observer / Target"-style label as an editable
  // name plus its coordinates, and keeps the map marker's tooltip in step.
  function renderEndpoint(el, point, fallback, marker) {
    if (!point) {
      el.textContent = 'not set';
      return;
    }
    el.innerHTML = '<span class="ep-name renameable" title="Click to rename"></span>' +
                   '<span class="ep-coords"></span>';
    const nameEl = el.querySelector('.ep-name');
    nameEl.textContent = labelFor(point, fallback);
    el.querySelector('.ep-coords').textContent =
      point.lat.toFixed(4) + ', ' + point.lng.toFixed(4);

    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      editInline(nameEl, point.name || '', (value) => {
        point.name = value;
        renderEndpoint(el, point, fallback, marker);
      });
    });

    tagMarker(marker, labelFor(point, fallback));
  }

  window.Naming = { labelFor, editInline, tagMarker, renderEndpoint };
})();
