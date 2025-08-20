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
        $('#cbf-repo-url').val($(this).val());
    });

    // Load repository structure
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
                repoTree = response.data.tree;
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

    // Display file tree with checkboxes
    function displayFileTree() {
        const extensions = $('#cbf-extensions').val().split(',').map(e => e.trim());
        const ignoreDirs = $('#cbf-ignore-dirs').val().split(',').map(d => d.trim().toLowerCase());

        const $tree = $('#cbf-file-tree');
        $tree.empty();

        // Create folder structure
        const folderStructure = {};

        repoTree.forEach(item => {
            if (item.type !== 'blob') return;

            const parts = item.path.split('/');
            const fileName = parts[parts.length - 1];
            const ext = '.' + fileName.split('.').pop();

            // Check if should ignore
            let shouldIgnore = false;
            for (let dir of ignoreDirs) {
                if (item.path.toLowerCase().includes(dir + '/')) {
                    shouldIgnore = true;
                    break;
                }
            }

            if (shouldIgnore) return;
            if (!extensions.includes(ext)) return;

            // Build folder structure
            let current = folderStructure;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = { _files: [], _folders: {} };
                }
                current = current[parts[i]]._folders;
            }

            if (!current[parts[parts.length - 2]]) {
                current[parts[parts.length - 2]] = { _files: [], _folders: {} };
            }
            current[parts[parts.length - 2]]._files.push({
                name: fileName,
                path: item.path,
                size: item.size
            });
        });

        // Render tree
        renderFolderStructure(folderStructure, $tree, '');

        // Add checkbox change handler
        $tree.on('change', 'input[type="checkbox"]', function() {
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

            if (folder._files || folder._folders) {
                // Create folder div
                const $folder = $(`<div class="cbf-folder" style="margin-left: ${indent}px;">
                    <span class="cbf-folder-name">📁 ${folderName}</span>
                    <div class="cbf-folder-contents"></div>
                </div>`);

                $container.append($folder);
                const $contents = $folder.find('.cbf-folder-contents');

                // Add files
                if (folder._files) {
                    folder._files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
                        const $file = $(`<div class="cbf-file" style="margin-left: ${indent + 20}px;">
                            <label>
                                <input type="checkbox" data-path="${file.path}" data-size="${file.size}">
                                <span>📄 ${file.name}</span>
                                <small>(${formatFileSize(file.size)})</small>
                            </label>
                        </div>`);
                        $contents.append($file);
                    });
                }

                // Recurse for subfolders
                if (folder._folders) {
                    renderFolderStructure(folder._folders, $contents, indent + 20);
                }

                // Add folder toggle
                $folder.find('.cbf-folder-name').on('click', function() {
                    $(this).next('.cbf-folder-contents').toggle();
                });
            }
        });
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function selectAllFiles() {
        $('#cbf-file-tree input[type="checkbox"]').prop('checked', true).trigger('change');
    }

    function deselectAllFiles() {
        $('#cbf-file-tree input[type="checkbox"]').prop('checked', false).trigger('change');
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
                continue; // Already fetched
            }

            try {
                // Get the raw URL from server
                const response = await $.post(cbf_ajax.ajax_url, {
                    action: 'cbf_github_api',
                    action_type: 'get_file',
                    repo_url: currentRepo,
                    branch: branch,
                    path: filePath,
                    token: token,
                    nonce: cbf_ajax.nonce
                });

                if (response.success) {
                    // Fetch from raw URL
                    const content = await $.get(response.data.download_url);
                    fileContents[filePath] = content;
                    fetchedCount++;

                    $('#cbf-fetch-selected').text(`Fetching... (${fetchedCount}/${totalFiles})`);
                }
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

        // Add file contents
        for (let [path, content] of Object.entries(fileContents)) {
            prompt += `\nFile: ${path}\n\`\`\`\n${content}\n\`\`\`\n`;
        }

        prompt += `\n\nCustom Instructions:\n${customInstructions}`;
        prompt += `\n\nRepeating User Query:\n${userQuery}`;

        $('#cbf-output').val(prompt);

        // Check token count
        const maxTokens = parseInt($('#cbf-max-tokens').val());
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
            totalChars += path.length + content.length + 20; // Extra for formatting
        }

        const customInstructions = $('#cbf-custom-instructions').val();
        const userQuery = $('#cbf-user-query').val();
        totalChars += customInstructions.length + userQuery.length + 100;

        const estimatedTokens = Math.ceil(totalChars / 4);
        $('#cbf-token-count').text(estimatedTokens.toLocaleString());

        const maxTokens = parseInt($('#cbf-max-tokens').val());
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
