export function setupGeocoder(map) {
    const SearchControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const div = L.DomUtil.create('div', 'leaflet-search-control');
            div.innerHTML = `<input type="text" placeholder="Search location…" id="search-input">
          <button id="search-btn" title="Search">⌕</button>`;
            L.DomEvent.disableClickPropagation(div);
            const input = div.querySelector('#search-input');
            const btn = div.querySelector('#search-btn');
            function doSearch() {
                const q = input.value.trim();
                if (!q) return;
                fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`)
                    .then(r => r.json())
                    .then(results => {
                        if (results.length > 0) {
                            const r = results[0];
                            map.setView([r.lat, r.lon], 12);
                            input.blur();
                        }
                    })
                    .catch(err => console.error('Search failed:', err));
            }
            L.DomEvent.on(btn, 'click', doSearch);
            L.DomEvent.on(input, 'keydown', e => { if (e.key === 'Enter') doSearch(); });
            return div;
        }
    });
    map.addControl(new SearchControl());
}
