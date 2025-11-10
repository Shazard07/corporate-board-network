// app.js

document.addEventListener('DOMContentLoaded', function() {
    if (typeof vis === 'undefined') {
        document.body.innerHTML = '<h1>Error: vis.js failed to load. Check your internet connection.</h1>';
        throw new Error('vis.js library not loaded');
    }

    const nodes = new vis.DataSet(nodesData);
    const edges = new vis.DataSet([]);

    const container = document.getElementById('network');
    const data = { nodes, edges };
    const options = {
        interaction: { hover: true, navigationButtons: true, keyboard: true },
        physics: {
            enabled: true,
            // tuned for responsiveness
            barnesHut: { gravitationalConstant: -800, springLength: 120 },
            stabilization: { iterations: 250 }
        },
        nodes: {
            font: { color: '#343434', size: 12, face: 'Arial' },
            borderWidth: 1,
            shadow: false,
            color: {
                background: '#3fa7d6',
                border: '#155a8a',
                highlight: { background: '#6ec6ff', border: '#155a8a' }
            }
        }
    };

    const network = new vis.Network(container, data, options);

    // Create tooltip element for showing company URL on hover
    const tooltip = document.createElement('div');
    tooltip.className = 'company-tooltip';
    document.body.appendChild(tooltip);

    // Cache frequently used DOM elements to avoid repeated lookups
    const breadcrumbDiv = document.getElementById('breadcrumb');
    const breadcrumbContent = document.getElementById('breadcrumbContent');
    const noticesDiv = document.getElementById('notices');
    const statsPill = document.getElementById('statsPill');
    const searchInput = document.getElementById('searchInput');
    const suggestionsDiv = document.getElementById('suggestions');

    // Refresh company nodes' labels so those with URLs show a single '🔗' indicator
    try {
        if (typeof companyURLs !== 'undefined') {
            const updates = nodes.get()
                .filter(n => n.shape === 'box')
                .map(n => {
                    const hasUrl = !!companyURLs[n.id];
                    // remove existing marker if present
                    let baseLabel = n.label;
                    if (baseLabel.endsWith(' 🔗')) baseLabel = baseLabel.slice(0, -2);
                    if (hasUrl) {
                        // ensure exactly one marker
                        return { id: n.id, label: baseLabel + ' 🔗' };
                    } else if (n.label !== baseLabel) {
                        // node previously had marker but now no URL — remove it
                        return { id: n.id, label: baseLabel };
                    }
                    return null;
                })
                .filter(Boolean);
            if (updates.length) nodes.update(updates);
        }
    } catch (e) {
        console.warn('Failed to refresh company labels with URLs', e);
    }

    // Track last mouse client coordinates for robust tooltip positioning
    let lastMouse = { x: 0, y: 0 };
    document.addEventListener('mousemove', function(e) {
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
    });

    // helper to show tooltip near mouse (using client coordinates)
    // allow pointer events on tooltip so user can click copy
    tooltip.style.pointerEvents = 'auto';
    function showTooltip(html, clientX, clientY) {
        tooltip.innerHTML = html;
        // position using client coords + page scroll
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;
        tooltip.style.left = (clientX + 12 + scrollX) + 'px';
        tooltip.style.top = (clientY + 12 + scrollY) + 'px';
        tooltip.style.display = 'block';
    }
    function hideTooltip() {
        tooltip.style.display = 'none';
    }

    const visibleDirectors = new Set();
    const companyDirectors = {};
    const companyDirectorsVisible = {};
    // Tracks nodes revealed by List mode; they persist until resetNetwork() is called
    const listModeVisible = new Set();

    Object.entries(directorCompanies).forEach(([director, companies]) => {
        companies.forEach(company => {
            if (!companyDirectors[company]) {
                companyDirectors[company] = [];
                companyDirectorsVisible[company] = false;
            }
            if (!companyDirectors[company].includes(director)) {
                companyDirectors[company].push(director);
            }
        });
    });

    // =================================================================
    // Mark directors connected to exactly one company as muted and unexpandable
    // This mirrors the post-processing that was intentionally moved into data.js
    // but needs to apply visible styling inside the running vis.DataSet here.
    (function finalizeSingleCompanyMarking() {
        const singleDirectors = Object.keys(directorCompanies)
            .filter(directorName => Array.isArray(directorCompanies[directorName]) && directorCompanies[directorName].length === 1);

        const updates = singleDirectors.map(id => {
            const node = nodes.get(id);
            if (node) {
                return {
                    id: id,
                    color: { background: '#e0e0e0', border: '#999' },
                    noExpand: true
                };
            }
            return null;
        }).filter(Boolean);

        if (updates.length > 0) nodes.update(updates);
    })();
    // =================================================================

    function blueEdge(from, to) { return { from, to, arrows: 'to', color: { color: 'blue' } }; }
    function orangeEdge(from, to) { return { from, to, arrows: 'to', color: { color: 'orange' } }; }

    // Add a directed edge but ensure we don't leave a reverse edge between the same nodes
    // This prevents showing arrows both ways for the same logical relationship.
    function addDirectedEdge(edgeObj) {
        try {
            // remove any reverse-direction edges (from edgeObj.to -> edgeObj.from)
            const reverse = edges.get({ filter: e => e.from === edgeObj.to && e.to === edgeObj.from });
            if (reverse.length) {
                edges.remove(reverse.map(e => e.id));
            }
            // if an identical edge doesn't already exist, add it; otherwise update metadata
            const existing = edges.get({ filter: e => e.from === edgeObj.from && e.to === edgeObj.to });
            if (!existing.length) {
                edges.add(edgeObj);
            } else {
                const ex = existing[0];
                const needsUpdate = (ex.color?.color !== edgeObj.color?.color) || (ex.dashes !== edgeObj.dashes) || (ex.arrows !== edgeObj.arrows);
                if (needsUpdate) edges.update({ id: ex.id, color: edgeObj.color, dashes: edgeObj.dashes, arrows: edgeObj.arrows });
            }
        } catch (e) {
            console.warn('addDirectedEdge failed', e);
            // fallback: try adding normally
            try { edges.add(edgeObj); } catch (_) {}
        }
    }

    function updateDottedOrangeEdges(affectedCompanies) {
        affectedCompanies.forEach(company => {
            const orangeEdges = edges.get({
                filter: e => e.to === company && e.color?.color === 'orange'
            });
            const isDashed = orangeEdges.length >= 2;
            orangeEdges.forEach(edge => {
                if (edge.dashes !== isDashed) {
                    edges.update({ id: edge.id, dashes: isDashed });
                }
            });
        });
    }

    // Exploration mode: 'visual' lets users expand nodes by clicking; 'list' opens breadcrumb/list without changing visual expansion
    let explorationMode = 'visual';
    function setExplorationMode(mode) {
        if (mode !== 'visual' && mode !== 'list') return;
        explorationMode = mode;
        // visual mode: clicks behave as before; list mode: clicks prefer breadcrumb/list UI
    if (noticesDiv) noticesDiv.textContent = `Explore mode: ${mode}`;
    }

    function resetNetwork() {
        const initialNodes = nodes.get().map(n => ({ ...n }));
        initialNodes.forEach(n => {
            n.hidden = !['Singtel', 'UOL', 'Seatrium'].includes(n.id);
        });
        nodes.update(initialNodes);
        edges.clear();
        Object.keys(companyDirectorsVisible).forEach(c => companyDirectorsVisible[c] = false);
        visibleDirectors.clear();
    // clear list mode visible nodes
    listModeVisible.clear();
        clearBreadcrumb();
    if (searchInput) searchInput.value = '';
    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
        refreshStats();
    }

    function clearBreadcrumb() {
    if (breadcrumbDiv) breadcrumbDiv.style.display = 'none';
    if (breadcrumbContent) breadcrumbContent.innerHTML = '';
    }

    function collapseSubtree(nodeId) {
        const childrenEdges = edges.get({ filter: e => e.from === nodeId });
        childrenEdges.forEach(edge => {
            const child = nodes.get(edge.to);
            if (child) {
                // Do not hide nodes that were revealed via List mode; they are persistent until reset
                if (!listModeVisible.has(edge.to)) {
                    nodes.update({ id: edge.to, hidden: true });
                }
                edges.remove(edge.id);
                // continue collapsing descendants, but collapseSubtree will also respect listModeVisible
                collapseSubtree(edge.to);
            }
        });
    }

    function updateBreadcrumb(clickedNode, connectedNodes, connectionType) {
        // use cached breadcrumbDiv / breadcrumbContent
        if (!connectedNodes || connectedNodes.length === 0) {
            if (breadcrumbDiv) breadcrumbDiv.style.display = 'none';
            return;
        }
        if (breadcrumbContent) breadcrumbContent.innerHTML = '';

        const nodeLabel = nodes.get(clickedNode)?.label || clickedNode;
        const website = typeof companyURLs !== 'undefined' ? companyURLs[clickedNode] : undefined;

    const mainLink = document.createElement('a');
    mainLink.className = 'breadcrumb-link';
    mainLink.href = '#';
    mainLink.textContent = nodeLabel;
    mainLink.style.cssText = 'background: #e3f2fd; padding: 2px 6px; border-radius: 4px; margin-right: 8px; text-decoration: none; color: inherit;';
    mainLink.addEventListener('click', (e) => { e.preventDefault(); handleBreadcrumbClick(clickedNode); });
    breadcrumbContent.appendChild(mainLink);

        if (website) {
            const a = document.createElement('a');
            a.href = website; a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.style.marginLeft = '8px'; a.style.fontSize = '12px';
            a.textContent = 'Website';
            breadcrumbContent.appendChild(a);
        }

        breadcrumbContent.appendChild(document.createTextNode(' \u2192 '));

        connectedNodes.forEach((nodeId, idx) => {
            const label = nodes.get(nodeId)?.label || nodeId;
            const itemLink = document.createElement('a');
            itemLink.className = 'breadcrumb-link';
            itemLink.href = '#';
            itemLink.textContent = label;
            const baseStyle = connectionType === 'directors' ? 'background: #fff3e0; padding: 2px 6px; border-radius: 4px; margin: 2px; text-decoration: none; color: inherit;' : 'background: #e3f2fd; padding: 2px 6px; border-radius: 4px; margin: 2px; text-decoration: none; color: inherit;';
            // If the target node is marked `noExpand`, show it with a muted style and disable expansion clicks
            const targetNode = nodes.get(nodeId);
            if (targetNode && targetNode.noExpand) {
                itemLink.style.cssText = baseStyle + ' background: #f5f5f5; border: 1px solid #999; color: #666; cursor: default;';
                itemLink.title = 'No further expansion available';
                itemLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (noticesDiv) {
                        noticesDiv.textContent = 'No further expansion for "' + (targetNode.label || nodeId) + '"';
                        setTimeout(() => { if (noticesDiv) noticesDiv.textContent = ''; }, 2500);
                    }
                });
            } else {
                itemLink.style.cssText = baseStyle;
                itemLink.addEventListener('click', (e) => { e.preventDefault(); handleBreadcrumbClick(nodeId); });
            }
            breadcrumbContent.appendChild(itemLink);
            if (idx < connectedNodes.length - 1) breadcrumbContent.appendChild(document.createTextNode(', '));
        });
        if (breadcrumbDiv) breadcrumbDiv.style.display = 'block';
    }

    function handleBreadcrumbClick(nodeId) {
        const node = nodes.get(nodeId);
        if (!node) return;
        // If we're in list mode, breadcrumb clicks should never change the visual graph.
        // Always show the appropriate list (companies for directors, directors for companies)
        if (explorationMode === 'list') {
            if (node.shape === 'box') {
                const board = companyDirectors[nodeId] || [];
                // reveal directors in list mode persistently (no edges)
                board.forEach(d => {
                    nodes.update({ id: d, hidden: false });
                    listModeVisible.add(d);
                });
                // also ensure company itself is visible
                nodes.update({ id: nodeId, hidden: false });
                listModeVisible.add(nodeId);
                updateBreadcrumb(nodeId, board, 'directors');
            } else {
                const companies = directorCompanies[nodeId] || [];
                companies.forEach(c => {
                    nodes.update({ id: c, hidden: false });
                    listModeVisible.add(c);
                });
                nodes.update({ id: nodeId, hidden: false });
                listModeVisible.add(nodeId);
                updateBreadcrumb(nodeId, companies, 'companies');
            }
            refreshStats();
            return;
        }

        // Visual mode: fallback to the visual toggle behavior
        toggleDirectorAndCompanyConnections(nodeId);
    }

    function toggleDirectorAndCompanyConnections(nodeId) {
        const clickedNode = nodes.get(nodeId);
        if (!clickedNode) return;

        if (clickedNode.shape === 'box' && companyDirectors[nodeId]) {
            const board = companyDirectors[nodeId];
            const shouldShow = !companyDirectorsVisible[nodeId];
            if (shouldShow) {
                board.forEach(m => {
                    nodes.update({ id: m, hidden: false });
                    if (!edges.get({ filter: x => x.from === nodeId && x.to === m }).length) {
                        addDirectedEdge(blueEdge(nodeId, m));
                    }
                });
            } else {
                board.forEach(m => {
                    const blueEdgeToRemove = edges.get({ filter: x => x.from === nodeId && x.to === m });
                    if (blueEdgeToRemove.length) edges.remove(blueEdgeToRemove.map(e => e.id));
                    // Also remove any orange edges from this director to the company so the graph fully collapses
                    const orangeEdgesFromDirector = edges.get({ filter: x => x.from === m && x.to === nodeId && x.color?.color === 'orange' });
                    if (orangeEdgesFromDirector.length) edges.remove(orangeEdgesFromDirector.map(e => e.id));
                    const isMemberOfOtherVisibleBoard = Object.keys(companyDirectorsVisible).some(company => company !== nodeId && companyDirectorsVisible[company] && companyDirectors[company].includes(m));
                    const hasOrangeEdges = visibleDirectors.has(m);
                    // Only hide directors if they are not protected by List mode
                    if (!isMemberOfOtherVisibleBoard && !hasOrangeEdges && !listModeVisible.has(m)) {
                        nodes.update({ id: m, hidden: true });
                    }
                    if (!isMemberOfOtherVisibleBoard) {
                        collapseSubtree(m);
                        visibleDirectors.delete(m);
                    }
                });
            }
            companyDirectorsVisible[nodeId] = shouldShow;
            if (shouldShow) updateBreadcrumb(nodeId, board, 'directors');
            else clearBreadcrumb();
            refreshStats();
            return;
        }

        if (directorCompanies[nodeId]) {
            const companies = directorCompanies[nodeId];
            const isVisible = visibleDirectors.has(nodeId);
            companies.forEach(co => {
                if (isVisible) {
                    // Hiding: remove orange edges from this director to the company and collapse any company subtree.
                    const remOrange = edges.get({ filter: x => x.from === nodeId && x.to === co && x.color?.color === 'orange' });
                    if (remOrange.length) edges.remove(remOrange.map(e => e.id));
                    // Collapse any descendants the company may have opened
                        // Only collapse or hide the company if it isn't currently open (clicked) by the user.
                        if (!companyDirectorsVisible[co]) {
                            collapseSubtree(co);
                            // If no other edges reference this company, hide it — but don't hide if it's protected by List mode
                            const otherEdges = edges.get({ filter: e => (e.from === co && e.to !== nodeId) || (e.to === co && e.from !== nodeId) });
                            if (!otherEdges.length && !listModeVisible.has(co)) {
                                nodes.update({ id: co, hidden: true });
                            }
                        }
                } else {
                    // Showing: ensure company node is visible and add orange edge from director
                    nodes.update({ id: co, hidden: false });
                    if (!edges.get({ filter: x => x.from === nodeId && x.to === co }).length) {
                        addDirectedEdge(orangeEdge(nodeId, co));
                    }
                }
            });
            updateDottedOrangeEdges(companies);
            if (isVisible) {
                visibleDirectors.delete(nodeId);
                clearBreadcrumb();
            } else {
                visibleDirectors.add(nodeId);
                const companiesForBreadcrumb = companies.filter(co => !edges.get({ filter: e => e.from === co && e.to === nodeId && e.color.color === 'blue' }).length);
                if (companiesForBreadcrumb.length > 0) {
                    updateBreadcrumb(nodeId, companiesForBreadcrumb, 'companies');
                }
            }
            if (directorCompanies[nodeId].length > 1) {
                nodes.update({ id: nodeId, hidden: false });
            }
            refreshStats();
            return;
        }
    }

    network.on('click', function (params) {
        if (!params?.nodes?.length) return;
        const clickedId = params.nodes[0];
        if (!clickedId) return;

        // In list mode, clicking a node opens the breadcrumb/list without forcing visual expansion/collapse
        if (explorationMode === 'list') {
            const node = nodes.get(clickedId);
            const connections = directorCompanies[clickedId] || companyDirectors[clickedId];
            // Reveal clicked node and its connected nodes persistently until reset
            nodes.update({ id: clickedId, hidden: false });
            listModeVisible.add(clickedId);
            if (connections && connections.length) {
                // reveal all connected nodes (companies or directors)
                connections.forEach(id => { nodes.update({ id, hidden: false }); listModeVisible.add(id); });
                const connectionType = node?.shape === 'ellipse' ? 'companies' : 'directors';
                updateBreadcrumb(clickedId, connections, connectionType);
            } else {
                updateBreadcrumb(clickedId, [], '');
            }
            refreshStats();
            return;
        }

        // visual mode (default): toggle visual expansion and collapse as before
        toggleDirectorAndCompanyConnections(clickedId);
        const outgoingEdges = edges.get({ filter: e => e.from === clickedId });
        if (outgoingEdges.length > 0 && !directorCompanies[clickedId] && !companyDirectors[clickedId]) {
            collapseSubtree(clickedId);
            refreshStats();
        }
    });

    // Show company URL in tooltip on hover — use lastMouse for stable client coordinates
    network.on('hoverNode', function(params) {
        const nodeId = params.node;
        const node = nodes.get(nodeId);
        if (!node) return;
        if (node.shape === 'box' && typeof companyURLs !== 'undefined') {
            const url = companyURLs[nodeId];
            const html = url ? `<strong>${node.label}</strong><br><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a><br><button class="copy-btn" data-url="${url}">Copy URL</button>` : `<strong>${node.label}</strong><br><em>No website available</em>`;
            // Prefer coordinates from the event if available (keyboard/page-scroll friendly)
            let px = lastMouse.x, py = lastMouse.y;
            try {
                const ev = params.event && (params.event.pointer || params.event.pointers && params.event.pointers[0]);
                if (ev && typeof ev.x === 'number' && typeof ev.y === 'number') {
                    px = ev.x; py = ev.y;
                }
            } catch (e) { /* ignore */ }
            showTooltip(html, px, py);
            // attach copy behavior
            setTimeout(() => {
                const btn = tooltip.querySelector('.copy-btn');
                if (btn) {
                    btn.addEventListener('click', (ev) => {
                        const u = ev.currentTarget.getAttribute('data-url');
                        if (navigator.clipboard && u) {
                            navigator.clipboard.writeText(u).then(() => {
                                btn.textContent = 'Copied!';
                                setTimeout(() => btn.textContent = 'Copy URL', 1500);
                            }).catch(() => alert('Copy failed'));
                        }
                    });
                }
            }, 0);
        }
    });

    network.on('blurNode', function(params) {
        hideTooltip();
    });

    // Also hide tooltip when clicking elsewhere
    document.addEventListener('click', function(e) {
        // only hide if click outside tooltip
        if (!e.target.closest('.company-tooltip')) hideTooltip();
    });

    // Physics is enabled by default; the toggle UI was removed to keep behaviour consistent.

    function refreshStats() {
    const visibleNodes = nodes.get().filter(n => !n.hidden).length;
    const visibleEdges = edges.get().length;
    if (statsPill) statsPill.textContent = `${visibleNodes} nodes • ${visibleEdges} edges visible`;
    }

    function searchAndZoom() {
        const searchTerm = document.getElementById('searchInput').value.trim();
        if (!searchTerm) return;
        regularSearch(searchTerm);
    }

    function regularSearch(searchTerm) {
        const allNodes = nodes.get();
        const matchingNodes = allNodes.filter(node => node.label.toLowerCase().includes(searchTerm.toLowerCase()));
        if (matchingNodes.length === 0) {
            alert(`No nodes found matching "${searchTerm}"`);
            return;
        }
        let targetNode = matchingNodes.find(node => node.label.toLowerCase() === searchTerm.toLowerCase()) || matchingNodes.find(node => node.shape === 'box') || matchingNodes[0];
        // In list mode we should not change graph visibility or focus — only show the breadcrumb/list.
        if (explorationMode === 'list') {
            const connections = directorCompanies[targetNode.id] || companyDirectors[targetNode.id];
            // reveal the node and connections persistently
            nodes.update({ id: targetNode.id, hidden: false });
            listModeVisible.add(targetNode.id);
            if (connections && connections.length) {
                connections.forEach(id => { nodes.update({ id, hidden: false }); listModeVisible.add(id); });
                const connectionType = targetNode.shape === 'ellipse' ? 'companies' : 'directors';
                updateBreadcrumb(targetNode.id, connections, connectionType);
            } else {
                updateBreadcrumb(targetNode.id, [], '');
            }
            refreshStats();
            return;
        }

        // Visual mode: reveal the node and focus it
        nodes.update({ id: targetNode.id, hidden: false });
        network.focus(targetNode.id, { scale: 1.5, animation: { duration: 1000, easingFunction: 'easeInOutQuad' } });
        
        const connections = directorCompanies[targetNode.id] || companyDirectors[targetNode.id];
        if (connections) {
            const connectionType = targetNode.shape === 'ellipse' ? 'companies' : 'directors';
            updateBreadcrumb(targetNode.id, connections, connectionType);
        }
        
        refreshStats();
    }

    // ...existing code...
    
    // Debounced input handler for suggestions
    let suggestionDebounce = null;
    searchInput.addEventListener('input', function(e) {
        const searchTerm = e.target.value.trim();
        clearTimeout(suggestionDebounce);
        suggestionDebounce = setTimeout(() => {
            if (searchTerm.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            const matchingNodes = nodes.get({ filter: node => node.label.toLowerCase().includes(searchTerm.toLowerCase())}).slice(0, 10);
            if (matchingNodes.length === 0) {
                suggestionsDiv.style.display = 'none';
                return;
            }
            matchingNodes.sort((a, b) => {
                const aExact = a.label.toLowerCase() === searchTerm.toLowerCase();
                const bExact = b.label.toLowerCase() === searchTerm.toLowerCase();
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                const aIsBox = a.shape === 'box';
                const bIsBox = b.shape === 'box';
                if (aIsBox && !bIsBox) return -1;
                if (!aIsBox && bIsBox) return 1;
                return a.label.localeCompare(b.label);
            });
            suggestionsDiv.innerHTML = '';
            matchingNodes.forEach(node => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = node.label;
                item.onclick = () => {
                    searchInput.value = node.label;
                    suggestionsDiv.style.display = 'none';
                    searchAndZoom();
                };
                suggestionsDiv.appendChild(item);
            });
            suggestionsDiv.style.display = 'block';
        }, 150);
    });

    document.addEventListener('click', function(e) { if (!e.target.closest('.search-container')) suggestionsDiv.style.display = 'none'; });

    // Wire up controls added/modified in index.html to avoid globals on window
    const resetButton = document.getElementById('resetButton');
    if (resetButton) resetButton.addEventListener('click', resetNetwork);
    const goButton = document.getElementById('goButton');
    if (goButton) goButton.addEventListener('click', searchAndZoom);
    const exploreVisual = document.getElementById('exploreVisual');
    const exploreList = document.getElementById('exploreList');
    if (exploreVisual) exploreVisual.addEventListener('change', () => setExplorationMode('visual'));
    if (exploreList) exploreList.addEventListener('change', () => setExplorationMode('list'));
    const clearBreadcrumbBtn = document.getElementById('clearBreadcrumbBtn');
    if (clearBreadcrumbBtn) clearBreadcrumbBtn.addEventListener('click', clearBreadcrumb);

    let selectedSuggestionIndex = -1;
    searchInput.addEventListener('keydown', function(e) {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
            updateSelectedSuggestion(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
            updateSelectedSuggestion(items);
        } else if (e.key === 'Enter') {
            if (selectedSuggestionIndex >= 0) {
                e.preventDefault();
                items[selectedSuggestionIndex].click();
            } else {
                // no suggestion selected: run search
                e.preventDefault();
                searchAndZoom();
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.style.display = 'none';
            selectedSuggestionIndex = -1;
        }
    });
    
    function updateSelectedSuggestion(items) {
        items.forEach((item, index) => {
            item.style.background = (index === selectedSuggestionIndex) ? '#e6f3ff' : '';
        });
    }
    
    // Initial Load
    // Run data consistency checks and then render stats
    function dataConsistencyCheck() {
        const nodeIds = new Set(nodes.get().map(n => n.id));
        const warnings = [];

        // Check companyURLs keys
        if (typeof companyURLs !== 'undefined') {
            Object.keys(companyURLs).forEach(k => {
                if (!nodeIds.has(k)) warnings.push(`companyURLs key missing node: "${k}"`);
            });
        }

        // Check companies referenced by directorCompanies
        Object.entries(directorCompanies).forEach(([director, companies]) => {
            if (!nodeIds.has(director)) warnings.push(`director entry missing node: "${director}"`);
            companies.forEach(c => { if (!nodeIds.has(c)) warnings.push(`company referenced by directorCompanies missing node: "${c}" (from ${director})`); });
        });

        if (warnings.length) {
            console.warn('Data consistency warnings:\n' + warnings.join('\n'));
            const noticesDiv = document.getElementById('notices');
            if (noticesDiv) {
                noticesDiv.innerHTML = warnings.slice(0,5).map(w => `&#x26A0; ${w}`).join('<br>');
                if (warnings.length > 5) noticesDiv.innerHTML += `<br>...and ${warnings.length - 5} more`;
            }
        }
    }

    dataConsistencyCheck();
    refreshStats();

      // REVISED: Logic for the Standalone Board Summary Search Panel (with Auto-Suggest)
    // =================================================================
    (function setupSummaryPanel() {
        const toggleBtn = document.getElementById('showSummaryBtn');
        const summaryPanel = document.getElementById('summaryPanel');
        const searchInput = document.getElementById('summarySearchInput');
        const searchBtn = document.getElementById('summarySearchBtn');
        const resultsDiv = document.getElementById('summaryResults');
        // Get the new suggestions container
        const suggestionsDiv = document.getElementById('summarySuggestions');

        if (!toggleBtn || !summaryPanel || !searchInput || !searchBtn || !resultsDiv || !suggestionsDiv) {
            return;
        }

        // --- Step 1: Prepare the data maps ---
        const companyToDirectorsMap = {};
        Object.entries(directorCompanies).forEach(([director, companies]) => {
            companies.forEach(company => {
                if (!companyToDirectorsMap[company]) {
                    companyToDirectorsMap[company] = [];
                }
                companyToDirectorsMap[company].push(director);
            });
        });
        // Create a simple array of company names for auto-suggestions
        const companyNames = Object.keys(companyToDirectorsMap).sort();

        // --- Step 2: Define the search function ---
        const performSearch = () => {
            suggestionsDiv.style.display = 'none'; // Hide suggestions when search is performed
            const searchTerm = searchInput.value.trim().toLowerCase();
            resultsDiv.innerHTML = '';

            if (!searchTerm) {
                resultsDiv.innerHTML = '<p style="color:#666;">Please enter a company name.</p>';
                return;
            }

            const companyName = Object.keys(companyToDirectorsMap).find(c => c.toLowerCase() === searchTerm);

            if (!companyName) {
                resultsDiv.innerHTML = `<p style="color:#b02a37;">Company "${searchInput.value}" not found in the dataset.</p>`;
                return;
            }

            const directorsOfCompany = companyToDirectorsMap[companyName];
            const resultHTML = [];

            directorsOfCompany.forEach(director => {
                const allBoards = directorCompanies[director];
                if (allBoards && allBoards.length > 1) {
                    resultHTML.push(
                        `<div style="margin-bottom: 8px; line-height: 1.4;">
                            <strong>${director}</strong>: (${allBoards.join(', ')})
                         </div>`
                    );
                }
            });

            if (resultHTML.length === 0) {
                resultsDiv.innerHTML = `<p>No directors from <strong>${companyName}</strong> were found on other boards.</p>`;
            } else {
                resultsDiv.innerHTML = resultHTML.join('');
            }
        };

        // --- Step 3: Add Auto-Suggestion Logic ---
        let suggestionDebounce = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(suggestionDebounce);
            suggestionDebounce = setTimeout(() => {
                const searchTerm = searchInput.value.trim().toLowerCase();
                if (searchTerm.length === 0) {
                    suggestionsDiv.style.display = 'none';
                    return;
                }

                const matchingCompanies = companyNames
                    .filter(name => name.toLowerCase().includes(searchTerm))
                    .slice(0, 10);

                if (matchingCompanies.length === 0) {
                    suggestionsDiv.style.display = 'none';
                    return;
                }

                suggestionsDiv.innerHTML = '';
                matchingCompanies.forEach(company => {
                    const item = document.createElement('div');
                    item.className = 'suggestion-item';
                    item.textContent = company;
                    item.onclick = () => {
                        searchInput.value = company;
                        suggestionsDiv.style.display = 'none';
                        performSearch(); // Automatically search on click
                    };
                    suggestionsDiv.appendChild(item);
                });
                suggestionsDiv.style.display = 'block';
            }, 150); // Debounce for 150ms
        });
        
        // Hide suggestions if user clicks elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.summary-search-container')) {
                suggestionsDiv.style.display = 'none';
            }
        });

        // --- Step 4: Add Keyboard Navigation for Suggestions ---
        let selectedSuggestionIndex = -1;
        searchInput.addEventListener('keydown', (e) => {
            const items = suggestionsDiv.querySelectorAll('.suggestion-item');
            if (suggestionsDiv.style.display === 'none' || items.length === 0) {
                if (e.key === 'Enter') { performSearch(); }
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0); // Can't go above top
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedSuggestionIndex >= 0) {
                    items[selectedSuggestionIndex].click();
                } else {
                    performSearch();
                }
            } else if (e.key === 'Escape') {
                suggestionsDiv.style.display = 'none';
            }

            items.forEach((item, index) => {
                item.style.background = (index === selectedSuggestionIndex) ? '#e6f3ff' : '';
            });
        });


        // --- Step 5: Wire up the main event listeners ---
        toggleBtn.addEventListener('click', () => {
            const isVisible = summaryPanel.style.display !== 'none';
            summaryPanel.style.display = isVisible ? 'none' : 'block';
            toggleBtn.textContent = isVisible ? 'Show Board Summary' : 'Hide Board Summary';
        });

        searchBtn.addEventListener('click', performSearch);
        
    })();

});