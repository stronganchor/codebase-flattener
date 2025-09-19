jQuery(document).ready(function($) {
    // ---------- State ----------
    let repoTree = [];
    let selectedFiles = new Set();
    let fileContents = {};
    let currentRepo = '';
    let pathToMeta = new Map(); // path -> { sha, size }

    // ---------- Constants ----------
    const CACHE_NS = 'cbf_cache_v1';

    // ---------- Boot ----------
    loadRecentRepos();

    // ---------- Event handlers ----------
    $('#cbf-load-repo').on('click', loadRepository);
    $('#cbf-select-all').on('click', selectAllFiles);
    $('#cbf-deselect-all').on('click', deselectAllFiles);
    $('#cbf-fetch-selected').on('click', fetchSelectedFiles);
    $('#cbf-generate-prompt').on('click', generatePrompt);
    $('#cbf-copy-prompt').on('click', copyToClipboard);
    $('#cbf-download-txt').on('click', downloadTxt);

    $('#cbf-recent-repos').on('change', function() {
        const selectedRepo = $(this).val();
        if (selectedRepo) {
            $('#cbf-repo-url').val(selectedRepo);
            loadRepository();
        }
    });

    // Inject a non-intrusive feedback badge next to the fetch button
    const $fetchBtn = $('#cbf-fetch-selected');
    if (!$('#cbf-fetch-feedback').length) {
        $('<span id="cbf-fetch-feedback" class="cbf-badge" aria-live="polite"></span>').insertAfter($fetchBtn);
    }

    // ---------- Repository loading ----------
    function loadRepository() {
        const repoUrl = $('#cbf-repo-url').val().trim();
        const branch = $('#cbf-branch').val().trim();
        const token = $('#cbf-github-token').val().trim();

        if (!repoUrl) {
            alert('Please enter a repository URL');
            return;
        }

        currentRepo = repoUrl;
        $('#cbf-loading').show();
        $('#cbf-file-tree').empty();
        selectedFiles.clear();
        fileContents = {};
        pathToMeta.clear();
        clearFetchFeedback();
        setButtonBusy($fetchBtn, false, 'Fetch Selected Files');

        $.post(cbf_ajax.ajax_url, {
            action: 'cbf_github_api',
            action_type: 'get_tree',
            repo_url: repoUrl,
            branch: branch,
            token: token,
            nonce: cbf_ajax.nonce
        })
        .done(function(response) {
            if (response.success) {
                repoTree = response.data.tree || [];
                displayFileTree();          // builds and binds the tree
                markCachedBadges();         // show which files are already cached & current
                // Auto-select everything by default
                selectAllFiles();
                syncAllFolderCheckboxes();
                saveToRecent(repoUrl);
            } else {
                alert('Error: ' + response.data);
            }
        })
        .fail(function() {
            alert('Failed to load repository');
        })
        .always(function() {
            $('#cbf-loading').hide();
        });
    }

    // ---------- Inputs parsing helpers ----------
    function parseExtensionsInput() {
        let raw = ($('#cbf-extensions').val() || '')
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);
        const includeAll = raw.length === 0 || raw.includes('*') || raw.includes('all');
        if (includeAll) return { includeAll: true, exts: null };
        const exts = raw.map(e => e.startsWith('.') ? e : ('.' + e));
        return { includeAll: false, exts: new Set(exts) };
    }

    function getLowerExt(fileName) {
        const lastDot = fileName.lastIndexOf('.');
        if (lastDot <= 0 || lastDot === fileName.length - 1) return '';
        return fileName.slice(lastDot).toLowerCase();
    }

    function parseIgnoreDirsInput() {
        return new Set(
            ($('#cbf-ignore-dirs').val() || '')
                .split(',')
                .map(d => d.trim().toLowerCase())
                .filter(Boolean)
        );
    }

    function pathContainsIgnoredDir(pathLower, ignoreSet) {
        if (ignoreSet.size === 0) return false;
        const segments = pathLower.split('/');
        for (let seg of segments) if (ignoreSet.has(seg)) return true;
        return false;
    }

    // ---------- File tree ----------
    function displayFileTree() {
        const extCfg = parseExtensionsInput();
        const ignoreSet = parseIgnoreDirsInput();

        const $tree = $('#cbf-file-tree');
        $tree.empty();

        const folderStructure = { _files: [], _folders: {} };

        repoTree.forEach(item => {
            if (item.type !== 'blob') return;

            const parts = item.path.split('/');
            const fileName = parts[parts.length - 1];
            const ext = getLowerExt(fileName);
            const pathLower = item.path.toLowerCase();

            if (pathContainsIgnoredDir(pathLower, ignoreSet)) return;

            // Exclude listed extensions
            if (!extCfg.includeAll) {
                if (extCfg.exts.has(ext)) return;
            }

            // Remember meta for caching/validation
            pathToMeta.set(item.path, { sha: item.sha, size: item.size });

            // Build folder structure
            let current = folderStructure;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current._folders[parts[i]]) {
                    current._folders[parts[i]] = { _files: [], _folders: {} };
                }
                current = current._folders[parts[i]];
            }

            current._files.push({
                name: fileName,
                path: item.path,
                size: item.size,
                sha: item.sha
            });
        });

        // Root files
        if (folderStructure._files.length > 0) {
            folderStructure._files
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(file => {
                    const $file = $(`
                        <div class="cbf-file" style="margin-left: 0px;">
                            <label title="${file.path}">
                                <input type="checkbox" data-path="${file.path}" data-size="${file.size}" data-sha="${file.sha}">
                                <span>📄 ${file.name}</span>
                                <small>(${formatFileSize(file.size)})</small>
                                <span class="cbf-file-status" data-path="${file.path}" aria-hidden="true"></span>
                            </label>
                        </div>
                    `);
                    $tree.append($file);
                });
        }

        renderFolderStructure(folderStructure._folders, $tree, 0, '');

        // Bind delegated handlers (namespaced so we don't clobber others)
        $tree.off('change.cbf-file')
             .on('change.cbf-file', '.cbf-file input[type="checkbox"]', function() {
                 const filePath = $(this).data('path');
                 if ($(this).prop('checked')) {
                     selectedFiles.add(filePath);
                 } else {
                     selectedFiles.delete(filePath);
                     delete fileContents[filePath];
                     setFileStatus(filePath, ''); // clear badge when deselected
                 }
                 updateTokenCount();
                 updateAncestorsFrom($(this));
             });

        $tree.off('change.cbf-folder')
             .on('change.cbf-folder', '.cbf-folder-checkbox', function() {
                 const $folder = $(this).closest('.cbf-folder');
                 const checked = $(this).prop('checked');
                 // When toggled, clear indeterminate and apply to all descendants
                 this.indeterminate = false;

                 // Toggle descendant files
                 $folder.find('.cbf-file input[type="checkbox"]').each(function() {
                     $(this).prop('checked', checked).trigger('change');
                 });

                 // Toggle descendant folder checkboxes
                 $folder.find('.cbf-folder-checkbox').each(function() {
                     $(this).prop('checked', checked);
                     this.indeterminate = false;
                 });

                 updateAncestorsFrom($(this));
             });

        $tree.off('click.cbf-folder-toggle keydown.cbf-folder-toggle')
             .on('click.cbf-folder-toggle', '.cbf-folder-name', function() {
                 $(this).closest('.cbf-folder').find('> .cbf-folder-contents').toggle();
             })
             .on('keydown.cbf-folder-toggle', '.cbf-folder-name', function(e) {
                 if (e.key === 'Enter' || e.key === ' ') {
                     e.preventDefault();
                     $(this).click();
                 }
             });
    }

    function renderFolderStructure(structure, $container, indent, parentPath) {
        Object.keys(structure).sort().forEach(folderName => {
            const folder = structure[folderName];
            const fullPath = parentPath ? (parentPath + '/' + folderName) : folderName;

            const $folder = $(`
                <div class="cbf-folder" data-folder-path="${fullPath}" style="margin-left: ${indent}px;">
                    <div class="cbf-folder-header">
                        <input type="checkbox" class="cbf-folder-checkbox" data-folder-path="${fullPath}">
                        <span class="cbf-folder-name" role="button" tabindex="0">📁 ${folderName}</span>
                    </div>
                    <div class="cbf-folder-contents"></div>
                </div>
            `);

            $container.append($folder);
            const $contents = $folder.find('.cbf-folder-contents');

            if (folder._files && folder._files.length) {
                folder._files
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .forEach(file => {
                        const $file = $(`
                            <div class="cbf-file" style="margin-left: ${indent + 20}px;">
                                <label title="${file.path}">
                                    <input type="checkbox" data-path="${file.path}" data-size="${file.size}" data-sha="${file.sha}">
                                    <span>📄 ${file.name}</span>
                                    <small>(${formatFileSize(file.size)})</small>
                                    <span class="cbf-file-status" data-path="${file.path}" aria-hidden="true"></span>
                                </label>
                            </div>
                        `);
                        $contents.append($file);
                    });
            }

            if (folder._folders) {
                renderFolderStructure(folder._folders, $contents, indent + 20, fullPath);
            }
        });
    }

    function formatFileSize(bytes) {
        if (typeof bytes !== 'number') return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ---------- Select / Deselect ----------
    function selectAllFiles() {
        const $boxes = $('#cbf-file-tree .cbf-file input[type="checkbox"]');
        selectedFiles.clear();
        $boxes.each(function() {
            const $box = $(this);
            $box.prop('checked', true);
            selectedFiles.add($box.data('path'));
        });
        // Mark all folder checkboxes checked (no indeterminate)
        $('#cbf-file-tree .cbf-folder-checkbox').each(function() {
            $(this).prop('checked', true);
            this.indeterminate = false;
        });
        updateTokenCount();
    }

    function deselectAllFiles() {
        const $boxes = $('#cbf-file-tree .cbf-file input[type="checkbox"]');
        $boxes.prop('checked', false);
        selectedFiles.clear();
        fileContents = {};
        $('#cbf-file-tree .cbf-file-status').removeClass('is-fetched is-cached is-error').attr('title', '');
        // Clear all folder checkboxes
        $('#cbf-file-tree .cbf-folder-checkbox').each(function() {
            $(this).prop('checked', false);
            this.indeterminate = false;
        });
        updateTokenCount();
    }

    // ---------- Folder checkbox tri-state helpers ----------
    function updateFolderCheckboxState($folder) {
        const $checkbox = $folder.find('> .cbf-folder-header > .cbf-folder-checkbox');
        const $descFileBoxes = $folder.find('.cbf-file input[type="checkbox"]');
        const total = $descFileBoxes.length;
        if (total === 0) {
            $checkbox.prop('checked', false);
            $checkbox[0].indeterminate = false;
            return;
        }
        const checked = $descFileBoxes.filter(':checked').length;
        if (checked === 0) {
            $checkbox.prop('checked', false);
            $checkbox[0].indeterminate = false;
        } else if (checked === total) {
            $checkbox.prop('checked', true);
            $checkbox[0].indeterminate = false;
        } else {
            $checkbox.prop('checked', false);
            $checkbox[0].indeterminate = true;
        }
    }

    function updateAncestorsFrom($elem) {
        $elem.parents('.cbf-folder').each(function() {
            updateFolderCheckboxState($(this));
        });
    }

    function syncAllFolderCheckboxes() {
        $('#cbf-file-tree .cbf-folder').each(function() {
            updateFolderCheckboxState($(this));
        });
    }

    // ---------- Fetch + Cache ----------
    async function fetchSelectedFiles() {
        if (selectedFiles.size === 0) {
            alert('No files selected');
            return;
        }

        const token = $('#cbf-github-token').val().trim();
        const branch = $('#cbf-branch').val().trim();
        const repoKey = getRepoKey(currentRepo, branch);

        setButtonBusy($fetchBtn, true, 'Fetching...');
        clearFetchFeedback();

        let fetchedCount = 0;
        const totalFiles = selectedFiles.size;

        // Progress update helper
        const updateProgress = () => {
            $fetchBtn.text(`Fetching... (${fetchedCount}/${totalFiles})`);
        };

        for (let filePath of selectedFiles) {
            const meta = pathToMeta.get(filePath) || {};
            const expectedSha = meta.sha || ($(`#cbf-file-tree input[data-path="${cssEscape(filePath)}"]`).data('sha') || null);

            // Try cache first
            const cached = getCacheEntry(repoKey, filePath);
            if (cached && cached.sha && cached.sha === expectedSha && typeof cached.content === 'string') {
                fileContents[filePath] = cached.content;
                setFileStatus(filePath, 'cached');
                fetchedCount++;
                updateProgress();
                continue;
            }

            // If cache exists but SHA differs, drop it
            if (cached && cached.sha && cached.sha !== expectedSha) {
                removeCacheEntry(repoKey, filePath);
            }

            try {
                const response = await $.post(cbf_ajax.ajax_url, {
                    action: 'cbf_github_api',
                    action_type: 'get_file',
                    repo_url: currentRepo,
                    branch: branch,
                    path: filePath,
                    token: token,
                    nonce: cbf_ajax.nonce
                });

                if (response && response.success && response.data && response.data.download_url) {
                    const content = await $.get(response.data.download_url);
                    fileContents[filePath] = content;
                    setCacheEntry(repoKey, filePath, {
                        sha: expectedSha || null,
                        content,
                        fetchedAt: Date.now()
                    });
                    setFileStatus(filePath, 'fetched');
                } else {
                    setFileStatus(filePath, 'error', 'Failed to get download URL');
                }
            } catch (error) {
                console.error(`Failed to fetch ${filePath}:`, error);
                setFileStatus(filePath, 'error', 'Network or API error');
            }

            fetchedCount++;
            updateProgress();
        }

        setButtonBusy($fetchBtn, false, 'Fetch Selected Files');
        updateTokenCount();

        // Non-intrusive success message (no alerts)
        if (fetchedCount === totalFiles) {
            setFetchFeedback(`Fetched ${fetchedCount} files ✓`, true);
        } else {
            setFetchFeedback(`Fetched ${fetchedCount} of ${totalFiles} files`, false);
        }
    }

    // ---------- Prompt generation / clipboard / download ----------
    function generatePrompt() {
        const customInstructions = $('#cbf-custom-instructions').val();
        const userQuery = $('#cbf-user-query').val();

        if (!userQuery) {
            alert('Please enter a query/request');
            return;
        }

        if (Object.keys(fileContents).length === 0) {
            alert('No file contents available. Please fetch selected files first.');
            return;
        }

        let prompt = `User Query:\n${userQuery}\n\n`;
        prompt += `Relevant Code Context:\n`;

        for (let [path, content] of Object.entries(fileContents)) {
            prompt += `\nFile: ${path}\n\`\`\`\n${content}\n\`\`\`\n`;
        }

        prompt += `\n\nCustom Instructions:\n${customInstructions}`;
        prompt += `\n\nRepeating User Query:\n${userQuery}`;

        $('#cbf-output').val(prompt);

        const maxTokens = parseInt($('#cbf-max-tokens').val(), 10);
        const estimatedTokens = Math.ceil(prompt.length / 4);

        if (estimatedTokens > maxTokens) {
            alert(`Warning: Estimated ${estimatedTokens} tokens exceeds max ${maxTokens}. Consider deselecting some files.`);
        }
    }

    function copyToClipboard() {
        const output = document.getElementById('cbf-output');
        output.select();
        document.execCommand('copy');

        const $btn = $('#cbf-copy-prompt');
        const originalText = $btn.text();
        $btn.text('Copied!');
        setTimeout(() => $btn.text(originalText), 2000);
    }

    function downloadTxt() {
        const text = $('#cbf-output').val() || '';
        if (!text.trim()) {
            alert('No prompt to download. Generate it first.');
            return;
        }
        const branch = ($('#cbf-branch').val() || 'main').trim();
    
        // Existing repo/branch slug
        const slug = (getRepoKey(currentRepo, branch) || 'prompt')
            .replace('@', '-')
            .replace(/[^\w\-\.]+/g, '-');
    
        // NEW: include first few words of user query in filename
        const querySnippet = getQuerySnippet(5, 48); // first 5 words, max ~48 chars
        const qsPart = querySnippet ? `-${querySnippet}` : '';
    
        const ts = timestampCompact();
        const filename = `enhanced-prompt-${slug}${qsPart}-${ts}.txt`;
    
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function timestampCompact() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    }

    // Make a filesystem-safe slug
    function makeSafeSlug(str, maxLen = 50) {
        if (!str) return 'no-query';
        let s = String(str)
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip accents
            .replace(/['"`]/g, '')                             // drop quotes
            .replace(/[^\w\s-]/g, ' ')                         // non-word -> space
            .trim()
            .replace(/\s+/g, '-')                              // spaces -> hyphens
            .toLowerCase()
            .replace(/-+/g, '-')                               // collapse hyphens
            .replace(/^[-_.]+|[-_.]+$/g, '');                  // trim punctuation
        if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, '');
        return s || 'no-query';
    }
    
    // Get first N words from the query and slugify them
    function getQuerySnippet(words = 5, maxLen = 50) {
        const q = ($('#cbf-user-query').val() || '').trim();
        if (!q) return '';
        const first = q.split(/\s+/).slice(0, words).join(' ');
        return makeSafeSlug(first, maxLen);
    }

    // ---------- Token counting ----------
    function updateTokenCount() {
        let totalChars = 0;

        for (let [path, content] of Object.entries(fileContents)) {
            totalChars += path.length + (content ? content.length : 0) + 20;
        }

        const customInstructions = $('#cbf-custom-instructions').val() || '';
        const userQuery = $('#cbf-user-query').val() || '';
        totalChars += customInstructions.length + userQuery.length + 100;

        const estimatedTokens = Math.ceil(totalChars / 4);
        $('#cbf-token-count').text(estimatedTokens.toLocaleString());

        const maxTokens = parseInt($('#cbf-max-tokens').val(), 10);
        $('#cbf-token-count').css('color', estimatedTokens > maxTokens ? 'red' : 'green');
    }

    // ---------- Recent repos ----------
    function loadRecentRepos() {
        $.post(cbf_ajax.ajax_url, {
            action: 'cbf_get_recent',
            nonce: cbf_ajax.nonce
        })
        .done(function(response) {
            if (response.success) {
                const $select = $('#cbf-recent-repos');
                $select.empty();
                response.data.forEach(repo => {
                    $select.append(`<option value="${repo}">${repo}</option>`);
                });
            }
        });
    }

    function saveToRecent(repoUrl) {
        $.post(cbf_ajax.ajax_url, {
            action: 'cbf_save_recent',
            repo_url: repoUrl,
            nonce: cbf_ajax.nonce
        })
        .done(function(response) {
            if (response.success) {
                loadRecentRepos();
            }
        });
    }

    // ---------- UI helpers ----------
    function setButtonBusy($btn, busy, textWhenNotBusy) {
        if (busy) {
            $btn.prop('disabled', true);
        } else {
            $btn.prop('disabled', false);
            $btn.text(textWhenNotBusy || $btn.text());
        }
    }

    function setFetchFeedback(msg, success) {
        const $fb = $('#cbf-fetch-feedback');
        $fb.text(msg)
           .removeClass('is-success is-error')
           .addClass(success ? 'is-success' : 'is-error');
        setTimeout(() => { $fb.addClass('fade'); }, 2500);
        setTimeout(() => { clearFetchFeedback(); }, 5000);
    }

    function clearFetchFeedback() {
        const $fb = $('#cbf-fetch-feedback');
        $fb.text('').removeClass('is-success is-error fade');
    }

    function setFileStatus(path, status, titleMsg = '') {
        const $badge = $(`.cbf-file-status[data-path="${cssEscape(path)}"]`);
        $badge.removeClass('is-fetched is-cached is-error');
        if (status === 'fetched') $badge.addClass('is-fetched').attr('title', 'Fetched');
        else if (status === 'cached') $badge.addClass('is-cached').attr('title', 'Loaded from cache');
        else if (status === 'error') $badge.addClass('is-error').attr('title', titleMsg || 'Error');
        else $badge.attr('title', '');
    }

    function markCachedBadges() {
        const branch = $('#cbf-branch').val().trim();
        const repoKey = getRepoKey(currentRepo, branch);
        $('#cbf-file-tree input[type="checkbox"][data-path]').each(function() {
            const path = $(this).data('path');
            const sha = $(this).data('sha') || null;
            const cached = getCacheEntry(repoKey, path);
            if (cached && cached.sha && cached.sha === sha) {
                setFileStatus(path, 'cached');
            }
        });
    }

    // CSS.escape polyfill-ish for attribute selectors
    function cssEscape(str) {
        return String(str).replace(/("|'|\\|\.|\[|\]|:|\/)/g, '\\$1');
    }

    // ---------- Cache helpers (localStorage) ----------
    function getRepoKey(repoUrl, branch) {
        // https://github.com/owner/repo(.git)? -> owner/repo@branch
        const m = (repoUrl || '').match(/github\.com\/([^\/]+)\/([^\/\?]+)/i);
        if (!m) return (repoUrl || 'repo') + '@' + (branch || 'main');
        const owner = m[1];
        const repo = m[2].replace(/\.git$/i, '');
        return `${owner}/${repo}@${branch}`;
    }

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_NS);
            if (!raw) return {};
            return JSON.parse(raw) || {};
        } catch {
            return {};
        }
    }

    function writeCache(obj) {
        try {
            localStorage.setItem(CACHE_NS, JSON.stringify(obj));
        } catch (e) {
            console.warn('Cache write failed:', e);
        }
    }

    function getCacheEntry(repoKey, path) {
        const all = readCache();
        return all?.[repoKey]?.[path] || null;
    }

    function setCacheEntry(repoKey, path, entry) {
        const all = readCache();
        if (!all[repoKey]) all[repoKey] = {};
        all[repoKey][path] = entry;
        writeCache(all);
    }

    function removeCacheEntry(repoKey, path) {
        const all = readCache();
        if (all[repoKey] && all[repoKey][path]) {
            delete all[repoKey][path];
            writeCache(all);
        }
    }
});
