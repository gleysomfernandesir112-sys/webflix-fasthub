document.addEventListener('DOMContentLoaded', () => {
    let allChannels = { filmes: {}, series: {}, tv: {} };
    const ITEMS_PER_PAGE = 20;
    let currentTab = 'filmes';
    let currentSubcat = 'all';
    const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB
    let lastNavigationTime = 0;
    const NAVIGATION_DEBOUNCE_MS = 1000;
    const CACHE_VALIDITY_MS = 24 * 3600000; // 24 horas

    function normalizeTitle(title) {
        return title ? title.trim().replace(/\b\w/g, c => c.toUpperCase()) : 'Sem Título';
    }

    function debounceNavigation(url) {
        const now = Date.now();
        if (now - lastNavigationTime < NAVIGATION_DEBOUNCE_MS) {
            console.warn('Navegação bloqueada por debounce:', url);
            return false;
        }
        lastNavigationTime = now;
        console.log('Navegando para:', url);
        return true;
    }

    async function loadM3U() {
        const cacheKey = `m3u_data`;
        const startTime = performance.now();
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const { timestamp, data } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_VALIDITY_MS && data && (
                    (data.filmes && Object.keys(data.filmes).length > 0) ||
                    (data.series && Object.keys(data.series).length > 0) ||
                    (data.tv && Object.keys(data.tv).length > 0)
                )) {
                    allChannels = data;
                    console.log('Carregado do cache:', Object.keys(allChannels.filmes).length, 'subcategorias de filmes,', Object.keys(allChannels.series).length, 'subcategorias de séries,', Object.keys(allChannels.tv).length, 'subcategorias de canais');
                    console.log(`Cache carregado em ${performance.now() - startTime} ms`);
                    displayChannels();
                    showLoadingIndicator(false);
                    return;
                } else {
                    console.log('Cache expirado ou inválido, recarregando...');
                }
            } catch (e) {
                console.error('Erro ao ler cache do localStorage:', e);
            }
        } else {
            console.log('Nenhum cache encontrado, carregando M3U...');
        }

        showLoadingIndicator(true);

        const filePaths = [
            './206609967_playlist.m3u',
            '/206609967_playlist.m3u',
            './206609967_playlist.M3U'
        ];
        const fallbackUrl = 'http://cdnnekotv.sbs/get.php?username=206609967&password=860883584&type=m3u_plus&output=m3u8';

        let content = null;
        let loadedFrom = '';

        for (const filePath of filePaths) {
            try {
                const fetchStart = performance.now();
                const response = await fetch(filePath, {
                    headers: { 'Accept': 'text/plain,*/*' }
                });
                if (response.ok) {
                    content = await response.text();
                    loadedFrom = filePath;
                    console.log(`Carregado de ${filePath} em ${performance.now() - fetchStart} ms`);
                    break;
                }
            } catch (error) {
                console.error(`Falha ao carregar ${filePath}:`, error.message);
            }
        }

        if (!content) {
            try {
                const fetchStart = performance.now();
                const response = await fetch(fallbackUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Accept': 'text/plain,*/*',
                        'Referer': 'http://localhost'
                    }
                });
                if (response.ok) {
                    content = await response.text();
                    loadedFrom = fallbackUrl;
                    console.log(`Carregado de fallback URL em ${performance.now() - fetchStart} ms`);
                }
            } catch (error) {
                console.error(`Falha ao carregar fallback URL:`, error.message);
                alert(`Erro ao carregar a lista M3U`);
                showLoadingIndicator(false);
                return;
            }
        }

        if (content) {
            parseM3UInWorker(content).then(parsedData => {
                allChannels = parsedData;
                console.log('Parse concluído via Worker:', Object.keys(allChannels.filmes).length, 'subcategorias de filmes,', Object.keys(allChannels.series).length, 'subcategorias de séries,', Object.keys(allChannels.tv).length, 'subcategorias de canais');
                try {
                    saveToCacheIfPossible();
                } catch (e) {
                    console.warn('Falha ao salvar cache, continuando com exibição:', e);
                }
                displayChannels();
                showLoadingIndicator(false);
                console.log(`Carregamento total levou ${performance.now() - startTime} ms`);
            }).catch(error => {
                console.error('Erro no Worker:', error);
                alert('Erro ao processar a lista M3U.');
                showLoadingIndicator(false);
            });
        } else {
            showLoadingIndicator(false);
            alert('Nenhum conteúdo M3U carregado.');
        }
    }

    function parseM3UInWorker(content) {
        return new Promise((resolve, reject) => {
            const workerCode = `
                self.onmessage = function(e) {
                    try {
                        var content = e.data;
                        var lines = content.split("\\n");
                        var allChannels = { filmes: {}, series: {}, tv: {} };
                        var currentChannel = null;

                        function normalizeTitle(title) {
                            return title ? title.trim().replace(/\\b\\w/g, function(c) { return c.toUpperCase(); }) : "Sem Título";
                        }

                        function parseGroup(group) {
                            var clean = group.replace(/[◆]/g, "").trim();
                            var parts = clean.split("|").map(function(part) { return part.trim(); });
                            var main = parts[0].toLowerCase();
                            var sub = parts.length > 1 ? parts[1] : "Outros";
                            return { main: main, sub: sub };
                        }

                        function categorizeChannel(channel) {
                            try {
                                var title = channel.title.toLowerCase();
                                var groupInfo = parseGroup(channel.group);
                                var main = groupInfo.main;
                                var sub = groupInfo.sub;
                                var hasSeriesPattern = /(s\\d{1,2}e\\d{1,2})|(temporada\\s*\\d+)|(episodio\\s*\\d+)/i.test(title);
                                var looksLikeLinearChannel = /(24h|canal|mix|ao vivo|live|4k|fhd|hd|sd|channel|tv|plus)/i.test(title);

                                if (main.includes("canais") || main.includes("canal") || looksLikeLinearChannel) {
                                    if (!allChannels.tv[sub]) allChannels.tv[sub] = [];
                                    allChannels.tv[sub].push({ 
                                        title: normalizeTitle(channel.title), 
                                        url: channel.url, 
                                        logo: channel.logo 
                                    });
                                    return;
                                }

                                if (main.includes("series") || main.includes("série")) {
                                    if (hasSeriesPattern && !looksLikeLinearChannel) {
                                        var seriesName, season, episodeTitle;
                                        var match = title.match(/^(.*?)\\s*[Ss](\\d{1,2})\\s*[Ee](\\d{1,2})/);
                                        if (match) {
                                            seriesName = normalizeTitle(match[1]);
                                            season = match[2];
                                            episodeTitle = "Episodio " + match[3];
                                        } else {
                                            seriesName = normalizeTitle(title.replace(/(temporada|episodio).*/i, "").trim());
                                            season = "1";
                                            episodeTitle = normalizeTitle(title);
                                        }
                                        var seriesKey = seriesName.toLowerCase();
                                        if (!allChannels.series[sub]) allChannels.series[sub] = {};
                                        var seriesSub = allChannels.series[sub];
                                        if (!seriesSub[seriesKey]) {
                                            seriesSub[seriesKey] = { displayName: seriesName, seasons: {}, logo: channel.logo };
                                        }
                                        if (!seriesSub[seriesKey].seasons[season]) {
                                            seriesSub[seriesKey].seasons[season] = [];
                                        }
                                        seriesSub[seriesKey].seasons[season].push({ title: episodeTitle, url: channel.url, logo: channel.logo });
                                        return;
                                    } else {
                                        if (!allChannels.tv[sub]) allChannels.tv[sub] = [];
                                        allChannels.tv[sub].push({ 
                                            title: normalizeTitle(channel.title), 
                                            url: channel.url, 
                                            logo: channel.logo 
                                        });
                                        return;
                                    }
                                }

                                if (main.includes("filmes") || main.includes("filme")) {
                                    if (!looksLikeLinearChannel && title.length > 5) {
                                        if (!allChannels.filmes[sub]) allChannels.filmes[sub] = [];
                                        allChannels.filmes[sub].push({ 
                                            title: normalizeTitle(channel.title), 
                                            url: channel.url, 
                                            logo: channel.logo 
                                        });
                                        return;
                                    } else {
                                        if (!allChannels.tv[sub]) allChannels.tv[sub] = [];
                                        allChannels.tv[sub].push({ 
                                            title: normalizeTitle(channel.title), 
                                            url: channel.url, 
                                            logo: channel.logo 
                                        });
                                        return;
                                    }
                                }

                                if (!allChannels.tv["Outros"]) allChannels.tv["Outros"] = [];
                                allChannels.tv["Outros"].push({ 
                                    title: normalizeTitle(channel.title), 
                                    url: channel.url, 
                                    logo: channel.logo 
                                });
                            } catch (error) {
                                console.error("Erro ao categorizar canal:", channel.title, error);
                                if (!allChannels.tv["Outros"]) allChannels.tv["Outros"] = [];
                                allChannels.tv["Outros"].push({ 
                                    title: normalizeTitle(channel.title), 
                                    url: channel.url, 
                                    logo: channel.logo 
                                });
                            }
                        }

                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i].trim();
                            try {
                                if (line.startsWith("#EXTINF:")) {
                                    var titleMatch = line.match(/,(.+)/) || line.match(/tvg-name="([^"]+)"/i);
                                    var groupMatch = line.match(/group-title="([^"]+)"/i);
                                    var logoMatch = line.match(/tvg-logo="([^"]+)"/i);
                                    var title = titleMatch ? titleMatch[1].trim() : "Canal Desconhecido";
                                    currentChannel = {
                                        title: title,
                                        url: "",
                                        group: groupMatch ? groupMatch[1] : "",
                                        logo: logoMatch ? logoMatch[1] : ""
                                    };
                                } else if (line && !line.startsWith("#") && currentChannel) {
                                    currentChannel.url = line;
                                    categorizeChannel(currentChannel);
                                    currentChannel = null;
                                }
                            } catch (error) {
                                console.error("Erro ao processar linha", i, ":", line, error);
                                currentChannel = null;
                            }
                        }

                        self.postMessage(allChannels);
                    } catch (error) {
                        self.postMessage({ error: "Erro geral no parsing: " + error.message });
                    }
                };
            `;

            const blob = new Blob([workerCode], { type: 'application/javascript; charset=utf-8' });
            const worker = new Worker(URL.createObjectURL(blob));

            worker.onmessage = (e) => {
                if (e.data.error) {
                    reject(new Error(e.data.error));
                } else {
                    resolve(e.data);
                }
                worker.terminate();
            };

            worker.onerror = (error) => {
                reject(error);
                worker.terminate();
            };

            worker.postMessage(content);
        });
    }

    function saveToCacheIfPossible() {
        let cacheData;
        try {
            cacheData = JSON.stringify({ timestamp: Date.now(), data: allChannels });
            if (cacheData.length < MAX_CACHE_SIZE) {
                localStorage.setItem('m3u_data', cacheData);
                console.log('Cache salvo com sucesso no localStorage');
            } else {
                console.warn('Cache excedeu o limite do localStorage, usando IndexedDB.');
                saveToIndexedDB(cacheData);
            }
        } catch (e) {
            console.error('Erro ao salvar no localStorage:', e);
            if (cacheData) {
                saveToIndexedDB(cacheData);
            } else {
                console.warn('cacheData não definido, ignorando salvamento no IndexedDB');
            }
        }
    }

    async function saveToIndexedDB(cacheData) {
        try {
            const dbRequest = indexedDB.open('m3uDatabase', 1);

            dbRequest.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('m3uStore')) {
                    db.createObjectStore('m3uStore', { keyPath: 'key' });
                }
            };

            const db = await new Promise((resolve, reject) => {
                dbRequest.onsuccess = () => resolve(dbRequest.result);
                dbRequest.onerror = () => reject(dbRequest.error);
            });

            const transaction = db.transaction(['m3uStore'], 'readwrite');
            const store = transaction.objectStore('m3uStore');
            await new Promise((resolve, reject) => {
                const request = store.put({ key: 'm3u_data', data: cacheData });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
            console.log('Cache salvo no IndexedDB');
        } catch (error) {
            console.error('Erro ao salvar no IndexedDB:', error);
        }
    }

    function showLoadingIndicator(show) {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.style.display = show ? 'block' : 'none';
        } else {
            console.warn('Elemento de loading (#loading) não encontrado no DOM');
        }
    }

    function getSubcatsForTab(tab) {
        let data;
        if (tab === 'filmes') data = allChannels.filmes;
        else if (tab === 'series') data = allChannels.series;
        else if (tab === 'tv') data = allChannels.tv;
        else return [];
        return Object.keys(data).sort();
    }

    function getFilteredItems(tab, filter = '') {
        const lowerFilter = filter.toLowerCase();
        let items = [];
        let data;

        if (tab === 'filmes') {
            data = allChannels.filmes;
            if (currentSubcat === 'all') {
                for (let sub in data) {
                    if (Array.isArray(data[sub])) {
                        items = items.concat(data[sub]);
                    }
                }
            } else if (data[currentSubcat] && Array.isArray(data[currentSubcat])) {
                items = data[currentSubcat];
            }
            return items.filter(item => item.title && item.title.toLowerCase().includes(lowerFilter));
        } else if (tab === 'series') {
            data = allChannels.series;
            let allSeriesObj = {};
            if (currentSubcat === 'all') {
                for (let sub in data) {
                    if (data[sub] && typeof data[sub] === 'object') {
                        for (let key in data[sub]) {
                            if (!allSeriesObj[key]) {
                                allSeriesObj[key] = data[sub][key];
                            } else {
                                console.log('Série duplicada encontrada:', key, 'em subcategorias diferentes. Mesclando temporadas.');
                                for (let s in data[sub][key].seasons) {
                                    if (!allSeriesObj[key].seasons[s]) {
                                        allSeriesObj[key].seasons[s] = data[sub][key].seasons[s];
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (data[currentSubcat] && typeof data[currentSubcat] === 'object') {
                for (let key in data[currentSubcat]) {
                    allSeriesObj[key] = data[currentSubcat][key];
                }
            }
            return Object.values(allSeriesObj).filter(item => item.displayName && item.displayName.toLowerCase().includes(lowerFilter));
        } else if (tab === 'tv') {
            data = allChannels.tv;
            if (currentSubcat === 'all') {
                for (let sub in data) {
                    if (Array.isArray(data[sub])) {
                        items = items.concat(data[sub]);
                    }
                }
            } else if (data[currentSubcat] && Array.isArray(data[currentSubcat])) {
                items = data[currentSubcat];
            }
            return items.filter(item => item.title && item.title.toLowerCase().includes(lowerFilter));
        }
        return [];
    }

    function displayChannels(filter = '') {
        const activeId = currentTab;
        const listContainer = document.getElementById(activeId);
        const paginationContainer = document.getElementById(`${activeId}-pagination`);

        if (!listContainer || !paginationContainer) {
            console.error('Container ou paginação não encontrado:', activeId);
            if (listContainer) {
                listContainer.innerHTML = '<p class="text-red-500 text-center">Erro: Container de paginação não encontrado.</p>';
            }
            return;
        }

        // Update subcategory selector
        const subcatSelector = document.getElementById('category-filter');
        if (!subcatSelector) {
            console.error('Seletor de categoria (#category-filter) não encontrado no DOM');
            listContainer.innerHTML = '<p class="text-red-500 text-center">Erro: Seletor de categoria não encontrado.</p>';
            return;
        }

        const previouslySelected = subcatSelector.value;
        subcatSelector.innerHTML = '<option value="all">Todas as Categorias</option>';
        const subcats = getSubcatsForTab(activeId);
        subcats.forEach(sub => {
            const option = document.createElement('option');
            option.value = sub;
            option.textContent = normalizeTitle(sub);
            subcatSelector.appendChild(option);
        });

        if (subcats.includes(previouslySelected)) {
            subcatSelector.value = previouslySelected;
            currentSubcat = previouslySelected;
        } else {
            subcatSelector.value = 'all';
            currentSubcat = 'all';
        }

        const filteredItems = getFilteredItems(activeId, filter);

        if (filteredItems.length === 0) {
            console.warn('Nenhum item encontrado para a aba:', activeId, 'subcat:', currentSubcat);
            listContainer.innerHTML = '<p class="text-gray-300 text-center">Nenhum item encontrado.</p>';
        } else {
            if (activeId === 'filmes') {
                displayPaginatedList(activeId, filteredItems, createMovieCard);
            } else if (activeId === 'series') {
                displayPaginatedList(activeId, filteredItems, createSeriesCard);
            } else if (activeId === 'tv') {
                displayPaginatedList(activeId, filteredItems, createTVCard);
            }
        }
    }

    function createMovieCard(item) {
        const div = document.createElement('div');
        div.className = 'card bg-gray-800 rounded-md overflow-hidden';
        div.innerHTML = `
            <img src="${item.logo || 'https://via.placeholder.com/200x300?text=Filme'}" alt="${item.title || 'Sem Título'}" class="w-full h-auto object-cover">
            <p class="p-2 text-center text-sm">${item.title || 'Sem Título'}</p>
        `;
        div.addEventListener('click', (e) => {
            e.preventDefault();
            const url = 'player-page.html?videoUrl=' + encodeURIComponent(item.url);
            if (debounceNavigation(url)) {
                window.location.href = url;
            }
        });
        return div;
    }

    function createSeriesCard(item) {
        const div = document.createElement('div');
        div.className = 'card bg-gray-800 rounded-md overflow-hidden';
        div.innerHTML = `
            <img src="${item.logo || 'https://via.placeholder.com/200x300?text=Série'}" alt="${item.displayName || 'Sem Título'}" class="w-full h-auto object-cover">
            <p class="p-2 text-center text-sm">${item.displayName || 'Sem Título'}</p>
        `;
        div.addEventListener('click', (e) => {
            e.preventDefault();
            openSeriesModal(item);
        });
        return div;
    }

    function createTVCard(item) {
        const div = document.createElement('div');
        div.className = 'card bg-gray-800 rounded-md overflow-hidden';
        div.innerHTML = `
            <img src="${item.logo || 'https://via.placeholder.com/200x300?text=TV'}" alt="${item.title || 'Sem Título'}" class="w-full h-auto object-cover">
            <p class="p-2 text-center text-sm">${item.title || 'Sem Título'}</p>
        `;
        div.addEventListener('click', (e) => {
            e.preventDefault();
            const url = 'player-page.html?videoUrl=' + encodeURIComponent(item.url);
            if (debounceNavigation(url)) {
                window.location.href = url;
            }
        });
        return div;
    }

    function displayPaginatedList(categoryId, items, createItemElement) {
        const listContainer = document.getElementById(categoryId);
        const paginationContainer = document.getElementById(`${categoryId}-pagination`);
        if (!listContainer || !paginationContainer) {
            console.error('Container ou paginação não encontrado:', categoryId);
            return;
        }

        let currentPage = 1;
        const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);

        function renderPage(page) {
            currentPage = page;
            listContainer.innerHTML = '';
            const start = (page - 1) * ITEMS_PER_PAGE;
            const end = start + ITEMS_PER_PAGE;
            items.slice(start, end).forEach(item => {
                try {
                    listContainer.appendChild(createItemElement(item));
                } catch (error) {
                    console.error('Erro ao criar card para item:', item, error);
                }
            });
            renderPagination();
        }

        function renderPagination() {
            paginationContainer.innerHTML = '';
            if (totalPages <= 1) return;

            const prevButton = document.createElement('button');
            prevButton.textContent = 'Anterior';
            prevButton.disabled = currentPage === 1;
            prevButton.className = 'px-4 py-2 bg-gray-700 text-white rounded mr-2 disabled:opacity-50';
            prevButton.addEventListener('click', () => renderPage(currentPage - 1));
            paginationContainer.appendChild(prevButton);

            const nextButton = document.createElement('button');
            nextButton.textContent = 'Próxima';
            nextButton.disabled = currentPage === totalPages;
            nextButton.className = 'px-4 py-2 bg-gray-700 text-white rounded disabled:opacity-50';
            nextButton.addEventListener('click', () => renderPage(currentPage + 1));
            paginationContainer.appendChild(nextButton);
        }

        renderPage(1);
    }

    window.switchTab = function(tab) {
        currentTab = tab;
        currentSubcat = 'all';
        document.querySelectorAll('.navbar a, .navbar div').forEach(a => a.classList.remove('active'));
        const tabElement = document.getElementById(`${tab}-tab`);
        if (tabElement) tabElement.classList.add('active');
        document.querySelectorAll('.category').forEach(c => c.classList.remove('active'));
        const categoryElement = document.getElementById(`${tab}-category`);
        if (categoryElement) categoryElement.classList.add('active');
        displayChannels(document.getElementById('search')?.value || '');
    }

    window.openSeriesModal = function(series) {
        const modal = document.getElementById('series-modal');
        if (!modal) {
            console.error('Modal de séries não encontrado');
            return;
        }
        const modalTitle = document.getElementById('modal-title');
        const seasonSelectorContainer = document.getElementById('season-selector');
        const episodesContainer = document.getElementById('modal-episodes');
        
        if (modalTitle) modalTitle.textContent = series.displayName || 'Sem Título';
        if (seasonSelectorContainer) seasonSelectorContainer.innerHTML = '';
        if (episodesContainer) episodesContainer.innerHTML = '';

        if (!series.seasons || Object.keys(series.seasons).length === 0) {
            if (episodesContainer) {
                episodesContainer.innerHTML = '<p class="text-red-500">Nenhum episódio encontrado para esta série.</p>';
            }
        } else {
            const sortedSeasons = Object.keys(series.seasons).sort((a, b) => a - b);

            const select = document.createElement('select');
            select.className = 'w-full bg-gray-700 text-white p-2 rounded-md';

            sortedSeasons.forEach(seasonNumber => {
                const option = document.createElement('option');
                option.value = seasonNumber;
                option.textContent = `Temporada ${seasonNumber}`;
                select.appendChild(option);
            });

            select.addEventListener('change', () => {
                const selectedSeason = select.value;
                if (episodesContainer) episodesContainer.innerHTML = '';
                const episodesList = document.createElement('ul');
                episodesList.className = 'space-y-2';
                if (series.seasons[selectedSeason]) {
                    series.seasons[selectedSeason].forEach(episode => {
                        const li = document.createElement('li');
                        li.className = 'p-2 hover:bg-gray-700 rounded cursor-pointer';
                        li.textContent = episode.title || 'Sem Título';
                        li.addEventListener('click', () => {
                            const url = 'player-page.html?videoUrl=' + encodeURIComponent(episode.url);
                            if (debounceNavigation(url)) {
                                window.location.href = url;
                            }
                        });
                        episodesList.appendChild(li);
                    });
                }
                if (episodesContainer) episodesContainer.appendChild(episodesList);
            });

            if (seasonSelectorContainer) seasonSelectorContainer.appendChild(select);
            select.dispatchEvent(new Event('change'));
        }

        modal.classList.add('show');
    }

    window.closeModal = function() {
        const modal = document.getElementById('series-modal');
        if (modal) modal.classList.remove('show');
    }

    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            displayChannels(this.value);
        });
    } else {
        console.warn('Input de busca (#search) não encontrado no DOM');
    }

    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
            currentSubcat = e.target.value;
            displayChannels(document.getElementById('search')?.value || '');
        });
    } else {
        console.error('Seletor de categoria (#category-filter) não encontrado no DOM');
    }

    loadM3U();
});