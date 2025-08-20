jQuery(document).ready(function($) {
    let repoTree = [];
    let selectedFiles = new Set();
    let fileContents = {};
    let currentRepo = '';

    // Load recent repos on page load
    loadRecentRepos();

    // Event handlers
    $('#cbf-load-repo').on('click', loadRepository);
    $('#cbf-select-all').on('click', selectAllFiles);
    $('#cbf-deselect-all').on('click', deselectAllFiles);
    $('#cbf-fetch-selected').on('click', fetchSelectedFiles);
    $('#cbf-generate-prompt').on('click', generatePrompt);
    $('#cbf-copy-prompt').on('click', copyToClipboard);
    $('#cbf-recent-repos').on('change', function() {
        const selectedRepo = $(this).val();
        if (selectedRepo) {
            $('#cbf-repo-url').val(selectedRepo);
            loadRepository(); // Automatically load the repository
        }
    });

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
                displayFileTree();
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

    // Helpers for robust filtering
    function parseExtensionsInput() {
        // Accept entries with or without dot; case-insensitive; allow "*" or "all" to include everything
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
        if (lastDot <= 0 || lastDot === fileName.length - 1) return ''; // no ext or trailing dot
        return fileName.slice(lastDot).toLowerCase();
    }

    function parseIgnoreDirsInput() {
        // Match by path segment, not substring
        return new Set(
            ($('#cbf-ignore-dirs').val() || '')
                .split(',')
                .map(d => d.trim().toLowerCase())
                .filter(Boolean)
        );
    }

    function pathContainsIgnoredDir(pathLower, ignoreSet) {
        if (ignoreSet.size === 0) return false;
        // Split into segments and see if any equals an ignored dir
        const segments = pathLower.split('/');
        for (let seg of segments) {
            if (ignoreSet.has(seg)) return true;
        }
        return false;
    }

    // Display file tree with checkboxes
    function displayFileTree() {
        const excludeExtensions = $('#cbf-extensions').val().split(',').map(e => e.trim()).filter(e => e);
        const ignoreDirs = $('#cbf-ignore-dirs').val().split(',').map(d => d.trim().toLowerCase());
    
        const $tree = $('#cbf-file-tree');
        $tree.empty();
    
        // Create folder structure
        const folderStructure = { _files: [], _folders: {} };
    
        console.log('Processing repoTree:', repoTree);
    
        repoTree.forEach(item => {
            if (item.type !== 'blob') return;
    
            const parts = item.path.split('/');
            const fileName = parts[parts.length - 1];
            const ext = '.' + fileName.split('.').pop();
    
            console.log('Processing file:', item.path, 'Parts:', parts);
    
            // Check if should ignore based on directory
            let shouldIgnore = false;
            for (let dir of ignoreDirs) {
                if (item.path.toLowerCase().includes(dir + '/')) {
                    shouldIgnore = true;
                    break;
                }
            }
    
            if (shouldIgnore) {
                console.log('Ignoring file:', item.path);
                return;
            }
    
            // Check if should exclude based on extension
            if (excludeExtensions.length > 0 && excludeExtensions.includes(ext)) {
                console.log('Excluding file due to extension:', item.path, ext);
                return;
            }
    
            // Build folder structure
            let current = folderStructure;
    
            // Navigate to the correct folder (all parts except the filename)
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current._folders[parts[i]]) {
                    current._folders[parts[i]] = { _files: [], _folders: {} };
                }
                current = current._folders[parts[i]];
            }
    
            // Add the file to the current folder
            current._files.push({
                name: fileName,
                path: item.path,
                size: item.size
            });
        });
    
        console.log('Final folder structure:', folderStructure);
    
        // Render tree - handle root files first
        if (folderStructure._files.length > 0) {
            folderStructure._files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
                const $file = $(`<div class="cbf-file" style="margin-left: 0px;">
                    <label>
                        <input type="checkbox" data-path="${file.path}" data-size="${file.size}">
                        <span>📄 ${file.name}</span>
                        <small>(${formatFileSize(file.size)})</small>
                    </label>
                </div>`);
                $tree.append($file);
            });
        }
    
        // Then render folders
        renderFolderStructure(folderStructure._folders, $tree, 0);
    
        // Add checkbox change handler (using event delegation)
        $tree.off('change').on('change', 'input[type="checkbox"]', function() {
            const filePath = $(this).data('path');
            const fileSize = $(this).data('size');
    
            if ($(this).prop('checked')) {
                selectedFiles.add(filePath);
            } else {
                selectedFiles.delete(filePath);
                delete fileContents[filePath];
            }
    
            updateTokenCount();
        });
    }

    function renderFolderStructure(structure, $container, indent) {
        Object.keys(structure).sort().forEach(folderName => {
            const folder = structure[folderName];

            const $folder = $(
                `<div class="cbf-folder" style="margin-left: ${indent}px;">
                    <span class="cbf-folder-name">📁 ${folderName}</span>
                    <div class="cbf-folder-contents"></div>
                </div>`
            );

            $container.append($folder);
            const $contents = $folder.find('.cbf-folder-contents');

            if (folder._files && folder._files.length) {
                folder._files
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .forEach(file => {
                        const $file = $(
                            `<div class="cbf-file" style="margin-left: ${indent + 20}px;">
                                <label title="${file.path}">
                                    <input type="checkbox" data-path="${file.path}" data-size="${file.size}">
                                    <span>📄 ${file.name}</span>
                                    <small>(${formatFileSize(file.size)})</small>
                                </label>
                            </div>`
                        );
                        $contents.append($file);
                    });
            }

            if (folder._folders) {
                renderFolderStructure(folder._folders, $contents, indent + 20);
            }

            $folder.find('.cbf-folder-name').on('click', function() {
                $(this).next('.cbf-folder-contents').toggle();
            });
        });
    }

    function formatFileSize(bytes) {
        if (typeof bytes !== 'number') return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Select/Deselect all without relying on firing thousands of change events
    function selectAllFiles() {
        const $boxes = $('#cbf-file-tree input[type="checkbox"]');
        selectedFiles.clear();
        $boxes.each(function() {
            const $box = $(this);
            $box.prop('checked', true);
            selectedFiles.add($box.data('path'));
        });
        updateTokenCount();
    }

    function deselectAllFiles() {
        const $boxes = $('#cbf-file-tree input[type="checkbox"]');
        $boxes.prop('checked', false);
        selectedFiles.clear();
        fileContents = {};
        updateTokenCount();
    }

    // Fetch content for selected files
    async function fetchSelectedFiles() {
        if (selectedFiles.size === 0) {
            alert('No files selected');
            return;
        }

        const token = $('#cbf-github-token').val().trim();
        const branch = $('#cbf-branch').val().trim();

        $('#cbf-fetch-selected').prop('disabled', true).text('Fetching...');

        let fetchedCount = 0;
        const totalFiles = selectedFiles.size;

        for (let filePath of selectedFiles) {
            if (fileContents[filePath]) {
                fetchedCount++;
                $('#cbf-fetch-selected').text(`Fetching... (${fetchedCount}/${totalFiles})`);
                continue;
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
                }
                fetchedCount++;
                $('#cbf-fetch-selected').text(`Fetching... (${fetchedCount}/${totalFiles})`);
            } catch (error) {
                console.error(`Failed to fetch ${filePath}:`, error);
            }
        }

        $('#cbf-fetch-selected').prop('disabled', false).text('Fetch Selected Files');
        updateTokenCount();

        if (fetchedCount === totalFiles) {
            alert(`Successfully fetched ${fetchedCount} files`);
        } else {
            alert(`Fetched ${fetchedCount} of ${totalFiles} files`);
        }
    }

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
        if (estimatedTokens > maxTokens) {
            $('#cbf-token-count').css('color', 'red');
        } else {
            $('#cbf-token-count').css('color', 'green');
        }
    }

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
});
