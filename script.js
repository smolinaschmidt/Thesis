const TMDB_API_KEY = '18dea89aea654fde541b73b5f34e97da';

const container = document.getElementById('comparisonContainer');
const statusText = document.getElementById('loadingStatus');
const colorThief = new ColorThief();

// Direct TMDB movie IDs to avoid wrong search results
const CARRIE_MOVIES = [
    { id: 7340,   title: 'Carrie', year: '1976' },
    { id: 7342,   title: 'Carrie', year: '2002' },
    { id: 133805, title: 'Carrie', year: '2013' }
];

/**
 * Fetch poster by TMDB movie ID (not search)
 */
async function fetchMovieById(tmdbId) {
    const resp = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`);
    return resp.json();
}

/**
 * Load image and extract palette
 */
function loadImageAndPalette(posterPath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const palette = colorThief.getPalette(img, 5);
            resolve({ img, palette });
        };
        img.onerror = reject;
        img.src = `https://image.tmdb.org/t/p/w500${posterPath}`;
    });
}

/**
 * Draw trailer barcode on a canvas
 */
function drawBarcode(canvas, framesData) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const frames = framesData.frames;
    const barWidth = w / frames.length;

    for (let i = 0; i < frames.length; i++) {
        const [r, g, b] = frames[i].color;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(Math.floor(i * barWidth), 0, Math.ceil(barWidth) + 1, h);
    }
}

/**
 * Build color grid mosaic from poster grid data
 */
function buildColorGrid(gridData) {
    const rows = gridData.grid.length;
    const cols = gridData.grid[0].length;

    const gridEl = document.createElement('div');
    gridEl.className = 'color-grid';
    gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    for (const row of gridData.grid) {
        for (const [r, g, b] of row) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.style.backgroundColor = `rgb(${r},${g},${b})`;
            gridEl.appendChild(cell);
        }
    }
    return gridEl;
}

/**
 * Build the full comparison view
 */
async function buildComparison() {
    statusText.innerText = 'Loading...';

    for (const movie of CARRIE_MOVIES) {
        try {
            // Fetch poster, grid JSON, and trailer colors JSON in parallel
            const [tmdbData, gridResp, colorsResp] = await Promise.all([
                fetchMovieById(movie.id),
                fetch(`poster_grid_${movie.year}.json`).then(r => r.json()),
                fetch(`colors_${movie.year}.json`).then(r => r.json())
            ]);

            // Row container
            const row = document.createElement('div');
            row.className = 'movie-row';

            // Title spanning entire row
            const label = document.createElement('h2');
            label.className = 'row-label';
            label.textContent = `${movie.title} (${movie.year})`;
            row.appendChild(label);

            // Column 1: Poster
            const posterCol = document.createElement('div');
            posterCol.className = 'poster-col';
            const colLabel1 = document.createElement('p');
            colLabel1.className = 'col-label';
            colLabel1.textContent = 'Poster';
            posterCol.appendChild(colLabel1);
            const posterImg = document.createElement('img');
            posterImg.src = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`;
            posterImg.alt = `${movie.title} (${movie.year}) poster`;
            posterCol.appendChild(posterImg);
            row.appendChild(posterCol);

            // Column 2: Color grid
            const gridCol = document.createElement('div');
            gridCol.className = 'grid-col';
            const colLabel2 = document.createElement('p');
            colLabel2.className = 'col-label';
            colLabel2.textContent = 'Poster palette';
            gridCol.appendChild(colLabel2);
            gridCol.appendChild(buildColorGrid(gridResp));
            row.appendChild(gridCol);

            // Column 3: Trailer barcode
            const barcodeCol = document.createElement('div');
            barcodeCol.className = 'barcode-col';
            const colLabel3 = document.createElement('p');
            colLabel3.className = 'col-label';
            colLabel3.textContent = 'Dominant color per scene in trailer';
            barcodeCol.appendChild(colLabel3);
            const canvas = document.createElement('canvas');
            canvas.className = 'barcode-canvas';
            canvas.width = colorsResp.frames.length;
            canvas.height = 400;
            barcodeCol.appendChild(canvas);
            row.appendChild(barcodeCol);

            container.appendChild(row);

            // Draw barcode after element is in DOM
            requestAnimationFrame(() => drawBarcode(canvas, colorsResp));

        } catch (e) {
            console.error('Error loading', movie.title, movie.year, e);
        }
    }

    statusText.innerText = '';
}

// === INTRO ANIMATION ===
function introDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIntro() {
    const overlay = document.getElementById('introOverlay');
    if (!overlay) return;

    const triptych = document.getElementById('introTriptych');
    const skipBtn = document.getElementById('skipIntro');

    let skipped = false;
    skipBtn.addEventListener('click', () => {
        skipped = true;
        endIntro();
    });

    // Preload all poster data in parallel
    const posterData = await Promise.all(CARRIE_MOVIES.map(async movie => {
        try {
            const [tmdbData, gridResp] = await Promise.all([
                fetchMovieById(movie.id),
                fetch(`poster_grid_${movie.year}.json`).then(r => r.json())
            ]);
            if (tmdbData.poster_path) {
                const { img } = await loadImageAndPalette(tmdbData.poster_path);
                return { ...movie, imgUrl: img.src, grid: gridResp.grid };
            }
        } catch (e) {
            console.error('Intro fetch error:', e);
        }
        return null;
    }));

    const validData = posterData.filter(Boolean);
    if (validData.length === 0 || skipped) { endIntro(); return; }

    // Build 3 cards in the DOM
    const cards = validData.map(data => {
        const card = document.createElement('div');
        card.className = 'intro-card';

        const wrap = document.createElement('div');
        wrap.className = 'intro-poster-wrap';

        const img = document.createElement('img');
        img.className = 'intro-poster';
        img.src = data.imgUrl;
        img.alt = `${data.title} (${data.year})`;
        wrap.appendChild(img);

        const gridOverlay = document.createElement('div');
        gridOverlay.className = 'intro-grid-overlay';
        const rows = data.grid.length;
        const cols = data.grid[0].length;
        gridOverlay.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        gridOverlay.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        const cells = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cell = document.createElement('div');
                cell.className = 'intro-grid-cell';
                const [rv, gv, bv] = data.grid[r][c];
                cell.style.backgroundColor = `rgb(${rv},${gv},${bv})`;
                gridOverlay.appendChild(cell);
                cells.push(cell);
            }
        }
        wrap.appendChild(gridOverlay);
        card.appendChild(wrap);

        const year = document.createElement('p');
        year.className = 'intro-year';
        year.textContent = `${data.title} (${data.year})`;
        card.appendChild(year);

        triptych.appendChild(card);
        return { card, img, cells, yearEl: year };
    });

    await introDelay(400);
    if (skipped) return;

    // Step 1: Fade in all 3 posters simultaneously
    cards.forEach(c => c.img.classList.add('visible'));
    await introDelay(1000);
    if (skipped) return;

    // Step 2: Show year labels
    cards.forEach(c => c.yearEl.classList.add('visible'));
    await introDelay(800);
    if (skipped) return;

    // Step 3: Reveal grid cells across all posters simultaneously
    // Shuffled indices per card for a natural feel
    const totalCells = cards[0].cells.length;
    const shuffledPerCard = cards.map(c => {
        const indices = c.cells.map((_, i) => i);
        for (let j = indices.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [indices[j], indices[k]] = [indices[k], indices[j]];
        }
        return indices;
    });

    const staggerMs = 70;
    for (let order = 0; order < totalCells; order++) {
        const delay = order * staggerMs;
        cards.forEach((c, ci) => {
            const idx = shuffledPerCard[ci][order];
            setTimeout(() => c.cells[idx].classList.add('revealed'), delay);
        });
    }

    // Wait for all cells to reveal
    await introDelay(totalCells * staggerMs + 500);
    if (skipped) return;

    // Hold
    await introDelay(2200);
    if (skipped) return;

    endIntro();
}

function endIntro() {
    const overlay = document.getElementById('introOverlay');
    if (!overlay || overlay.classList.contains('fade-out')) return;
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.style.display = 'none'; }, 900);
}

// === BUBBLE CHART: COLOR PREDOMINATION ===

/**
 * Classify an RGB color into a named category using HSL conversion
 */
function classifyColor(r, g, b) {
    const rf = r / 255, gf = g / 255, bf = b / 255;
    const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;
    const d = max - min;
    let s = 0, h = 0;

    if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
        else if (max === gf) h = ((bf - rf) / d + 2) / 6;
        else h = ((rf - gf) / d + 4) / 6;
    }

    const hDeg = h * 360;

    // Achromatic checks
    if (l < 0.08) return 'Black';
    if (l > 0.90) return 'White';
    if (s < 0.12) return 'Gray';

    // Chromatic
    if (hDeg < 15)  return 'Red';
    if (hDeg < 40)  return 'Orange';
    if (hDeg < 65)  return 'Yellow';
    if (hDeg < 160) return 'Green';
    if (hDeg < 250) return 'Blue';
    if (hDeg < 300) return 'Purple';
    if (hDeg < 340) return 'Pink';
    return 'Red'; // wraps around
}

/** Canonical display color for each category */
const CATEGORY_COLORS = {
    Red:    '#c0392b',
    Orange: '#e67e22',
    Yellow: '#f1c40f',
    Green:  '#27ae60',
    Blue:   '#2980b9',
    Purple: '#8e44ad',
    Pink:   '#e84393',
    Brown:  '#795548',
    Black:  '#1a1a1a',
    Gray:   '#7f8c8d',
    White:  '#ecf0f1'
};

/**
 * Build bubble charts for all three Carrie movies
 */
async function buildBubbleCharts() {
    const container = document.getElementById('bubbleCharts');
    if (!container) return;

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'bubble-tooltip';
    document.body.appendChild(tooltip);

    for (const movie of CARRIE_MOVIES) {
        try {
            const colorsData = await fetch(`colors_${movie.year}.json`).then(r => r.json());
            const frames = colorsData.frames;

            // Count color categories
            const counts = {};
            for (const frame of frames) {
                const [r, g, b] = frame.color;
                const cat = classifyColor(r, g, b);
                counts[cat] = (counts[cat] || 0) + 1;
            }

            // Convert to array sorted by count desc
            const data = Object.entries(counts)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value);

            // Card
            const card = document.createElement('div');
            card.className = 'bubble-chart-card';
            const title = document.createElement('h3');
            title.textContent = `Carrie (${movie.year})`;
            card.appendChild(title);

            // D3 bubble pack
            const size = 340;
            const root = d3.hierarchy({ children: data }).sum(d => d.value);
            d3.pack().size([size, size]).padding(4)(root);

            const svg = d3.create('svg')
                .attr('width', size)
                .attr('height', size)
                .attr('viewBox', `0 0 ${size} ${size}`);

            const nodes = svg.selectAll('g')
                .data(root.leaves())
                .join('g')
                .attr('transform', d => `translate(${d.x},${d.y})`);

            nodes.append('circle')
                .attr('r', d => d.r)
                .attr('fill', d => CATEGORY_COLORS[d.data.name] || '#555')
                .attr('stroke', '#000')
                .attr('stroke-width', 0.5)
                .attr('opacity', 0.9)
                .on('mouseenter', (event, d) => {
                    const pct = ((d.data.value / frames.length) * 100).toFixed(1);
                    tooltip.textContent = `${d.data.name}: ${d.data.value} frames (${pct}%)`;
                    tooltip.style.opacity = '1';
                })
                .on('mousemove', (event) => {
                    tooltip.style.left = (event.pageX + 12) + 'px';
                    tooltip.style.top = (event.pageY - 28) + 'px';
                })
                .on('mouseleave', () => {
                    tooltip.style.opacity = '0';
                });

            // Labels only on bubbles large enough
            nodes.filter(d => d.r > 20)
                .append('text')
                .attr('text-anchor', 'middle')
                .attr('dy', '-0.2em')
                .attr('fill', d => ['Black', 'Blue', 'Purple', 'Red'].includes(d.data.name) ? '#fff' : '#000')
                .attr('font-size', d => Math.min(d.r * 0.55, 13) + 'px')
                .attr('font-weight', '600')
                .text(d => d.data.name);

            nodes.filter(d => d.r > 20)
                .append('text')
                .attr('text-anchor', 'middle')
                .attr('dy', '1em')
                .attr('fill', d => ['Black', 'Blue', 'Purple', 'Red'].includes(d.data.name) ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')
                .attr('font-size', d => Math.min(d.r * 0.4, 10) + 'px')
                .text(d => ((d.data.value / frames.length) * 100).toFixed(1) + '%');

            card.appendChild(svg.node());
            container.appendChild(card);

        } catch (e) {
            console.error('Bubble chart error for', movie.year, e);
        }
    }
}

// Start — intro plays, then comparison loads behind it
runIntro();
buildComparison();
buildBubbleCharts();