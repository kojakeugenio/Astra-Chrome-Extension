/**
 * FB Toolkit — Proxy Injection Script
 * Injected into the MAIN world at document_start.
 * Hooks into Facebook's internal module system (__d) to intercept and modify
 * module behavior for privacy features (unseen, typing, stories).
 */
(function () {
    'use strict';

    // Prevent double-injection
    if (window.__fb_toolkit_proxy_loaded) return;
    window.__fb_toolkit_proxy_loaded = true;

    // ── Obfuscated string decoder ─────────────────────────────────────────────
    // FB module names are sometimes readable and sometimes obfuscated
    // (reverse string + charCode-1). Decode only when needed.
    function looksLikeReadableModuleName(name) {
        const readablePatterns = [
            /^Comet/,
            /^Base/,
            /^Relay/,
            /^Polaris/,
            /^MWP/,
            /^use/,
            /^react$/,
            /^cr:\d+/,
            /^__debug$/,
            /^Async$/,
            /^Bootloader$/,
            /^CurrentUser$/,
            /^DTSG$/,
            /^DynamicUFIReactionTypes$/,
            /^Env$/,
            /^ErrorPubSub$/,
            /^I64$/,
            /^Lexical$/,
            /^entrypoint$/,
            /^ReQLSuspense$/,
            /^RunComet$/,
            /^SprinkleConfig$/,
            /^WebPixelRatio$/,
            /^XHRRequest$/,
            /^cometAsyncFetch$/,
            /^getAsyncParams$/,
            /^ifRequired$/,
            /^normalizeCometRouterUrl$/,
            /^queryMWLSOtherParticipantContact$/
        ];

        const readablePrefix =
            name.startsWith('relay') ||
            name.startsWith('fb') ||
            name.startsWith('graphql') ||
            name.startsWith('use') ||
            name.startsWith('I64');

        const lower = name.toLowerCase();
        return (
            readablePrefix ||
            lower.includes('react') ||
            lower.includes('.bs') ||
            readablePatterns.some((re) => re.test(name))
        );
    }

    function decodeStr(s) {
        if (looksLikeReadableModuleName(s)) {
            return s;
        }

        const decoded = s
            .split('')
            .reverse()
            .map((c) => String.fromCharCode(c.charCodeAt(0) - 1))
            .join('');

        return decoded.split('|')[0];
    }

    // ── Function cache for dynamic function creation ──────────────────────────
    window.__fnCache = window.__fnCache || {};
    const commentRegex = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm;
    const argsRegex = /([^\s,]+)/g;

    function createFnFromString(fnStr) {
        const body = fnStr.slice(fnStr.indexOf('{') + 1, fnStr.lastIndexOf('}')) || '';
        const cleaned = fnStr.replace(commentRegex, '');
        const argsMatch = cleaned.slice(cleaned.indexOf('(') + 1, cleaned.indexOf(')')).match(argsRegex) || [];

        const id = 'id_' + crypto.randomUUID();
        const code = `window['__fnCache']["${id}"]= function(${argsMatch}){${body}}`;
        const script = document.createElement('script');
        try { script.appendChild(document.createTextNode(code)); } catch (e) { script.text = code; }
        const head = document.getElementsByTagName('head')[0] || document.documentElement;
        head.appendChild(script);
        head.removeChild(script);
        return window.__fnCache[id];
    }

    // ── Copy function properties (preserving internal FB metadata) ────────────
    function wrapFunction(original, replacement) {
        const props = Object.getOwnPropertyNames(original);
        const wrapped = function (...args) { return replacement.apply(this, args); };
        props.forEach(p => {
            if (p.startsWith('__')) {
                Object.defineProperty(wrapped, p, {
                    value: original[p], writable: false, enumerable: false, configurable: true
                });
            }
        });
        return wrapped;
    }

    // ── Module System Hooks ───────────────────────────────────────────────────
    const moduleStringReplacements = {};  // moduleName → [{replacement, options}]
    const moduleExportListeners = {};     // moduleName → [callback]
    const processedModules = [];

    /**
     * Register a string replacement for a module's source code.
     */
    function registerStringReplacement(encodedName, replacementFn, options) {
        const opts = Object.assign({ order: 10, skipOthers: false }, options);
        const moduleName = decodeStr(encodedName);
        moduleStringReplacements[moduleName] = moduleStringReplacements[moduleName] || [];
        moduleStringReplacements[moduleName].push({ options: opts, replacement: replacementFn });
    }

    /**
     * Register a listener for when a module's exports are available.
     */
    function registerExportListener(encodedName, callback) {
        const moduleName = decodeStr(encodedName);
        moduleExportListeners[moduleName] = moduleExportListeners[moduleName] || [];
        moduleExportListeners[moduleName].push(callback);
    }

    // ── Core __d Proxy ────────────────────────────────────────────────────────
    function processModuleArgs(args) {
        let [name, , factory] = args;
        if (typeof name !== 'string' || processedModules.includes(name)) return args;
        processedModules.push(name);

        // Apply string replacements
        if (moduleStringReplacements[name]) {
            const replacements = moduleStringReplacements[name];
            replacements.sort((a, b) => a.options.order - b.options.order);
            const skipEntry = replacements.find(r => r.options.skipOthers);
            const modifiedSource = skipEntry
                ? skipEntry.replacement(factory.toString())
                : replacements.reduce((src, r) => r.replacement(src), factory.toString());
            args[2] = createFnFromString(modifiedSource);
        }

        // Apply export listeners
        if (moduleExportListeners[name]) {
            args[2] = new Proxy(args[2], {
                apply(target, thisArg, fnArgs) {
                    if (fnArgs[5] && fnArgs[5].dependencies) {
                        for (let i = 0; i < fnArgs[5].dependencies.length; i++) {
                            fnArgs.push(fnArgs[5].dependencies[i].exports);
                        }
                    }
                    const result = target.apply(thisArg, fnArgs);
                    moduleExportListeners[name].forEach(cb => cb(fnArgs));
                    return result;
                }
            });
        }

        return args;
    }

    // ── Install the __d Proxy ─────────────────────────────────────────────────
    let currentD = window.__d;

    if (window.__d) {
        if (~currentD.toString().indexOf('__d_stub')) {
            delete window.__d;
        } else {
            currentD = new Proxy(window.__d, {
                apply: (target, thisArg, args) => {
                    args = processModuleArgs(args);
                    return target.apply(thisArg, args);
                }
            });
        }
    }

    Object.defineProperty(window, '__d', {
        get: function () { return currentD; },
        set: function (value) {
            currentD = new Proxy(value, {
                apply: (target, thisArg, args) => {
                    args = processModuleArgs(args);
                    return target.apply(thisArg, args);
                }
            });
        }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // RELAY STORE FINDER - For Ad Detection
    // ══════════════════════════════════════════════════════════════════════════

    // Capture Relay store reference when it's created
    registerStringReplacement(
        'relay-runtime/store/RelayPublishQueue',
        (src) => src.replace(
            /,(\w+)=new\((\w+)\("relay-runtime\/mutations\/RelayRecordSourceProxy"/,
            ',$1=window["__fb_toolkit_relay_proxy"]=new($2("relay-runtime/mutations/RelayRecordSourceProxy"'
        )
    );

    /**
     * Query the Relay store for data by record ID and path.
     * Path syntax:
     *   ^ = getLinkedRecord (single)
     *   ^^ = getLinkedRecords (array)
     *   {argKey} = lookup args object
     *   * = return current value
     * 
     * Example: storeFinder(id, "^sponsored_data.ad_id") checks for ad presence
     */
    window.storeFinder = function (id, path, args) {
        const proxy = window.__fb_toolkit_relay_proxy;
        if (!proxy) return undefined;

        const record = typeof id === 'string' ? proxy.get(id) : id;
        if (record === undefined) return record;

        // Parse path with support for linked records and args
        let parts = path.replace(/\[(\d+)\]/g, '.$1')
            .replace(/\((.*?)\.(.*?)\)/g, '($1_*_*_*_*_$2)')
            .split('.');

        parts = parts.map(p => p.replaceAll('_*_*_*_*_', '.'));

        let current = record;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            if (part === '*') {
                return current;
            }

            if (part.startsWith('^^')) {
                const [fieldName, fieldArgs] = parseFieldWithArgs(part.substring(2));
                current = current.getLinkedRecords(fieldName, fieldArgs);
                if (current === undefined) return undefined;
            } else if (part.startsWith('^')) {
                const [fieldName, fieldArgs] = parseFieldWithArgs(part.substring(1));
                current = current.getLinkedRecord(fieldName, fieldArgs);
                if (current == null) return undefined;
            } else if (/^\d+$/.test(part)) {
                current = current[parseInt(part)];
                if (current == null) return undefined;
            } else {
                const [fieldName, fieldArgs] = parseFieldWithArgs(part);
                current = current.getValue(fieldName, fieldArgs);
                if (current == null) return undefined;
            }
        }

        return current;

        function parseFieldWithArgs(part) {
            const [name, argsKey] = part.split('{');
            if (!argsKey) return [name, {}];
            if (!args) throw new Error('args undefined');
            return [name, args[argsKey.substring(0, argsKey.length - 1)] || {}];
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
    // MODULE PROXY SYSTEM - For Component Interception (Ad Blocking)
    // ══════════════════════════════════════════════════════════════════════════

    const moduleProxies = {};               // Component proxies storage
    const moduleProxyListenerBound = {};    // Track listener registration per module

    /**
     * Deep get property from object using dot notation
     */
    function deepGet(obj, path, returnParent = false) {
        const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
        let parent, current = obj;

        for (let i = 0; i < parts.length; i++) {
            parent = current;
            current = current[parts[i]];
            if (current === undefined) {
                return returnParent ? parent : undefined;
            }
        }
        return returnParent ? parent : current;
    }

    /**
     * Register a module for component-level proxy interception.
     * This allows wrapping React components to filter/modify their output.
     */
    window.moduleProxyDefine = function (moduleName, options = {}) {
        const defaults = {
            order: 10,
            skipOthers: false,
            definerPath: '[6].default'  // Where the component lives in module args
        };
        const opts = Object.assign({}, defaults, options);

        moduleProxies[moduleName] = moduleProxies[moduleName] || [];
        moduleProxies[moduleName].push({
            moduleName: moduleName,
            options: opts,
            component: undefined,
            fallback: undefined
        });

        // Ensure this module is actually intercepted when it loads.
        if (!moduleProxyListenerBound[moduleName]) {
            moduleProxyListenerBound[moduleName] = true;
            registerExportListener(moduleName, (args) => {
                if (!moduleProxies[moduleName] || !moduleProxies[moduleName].length) return;

                const path = moduleProxies[moduleName][0].options.definerPath;
                const parent = deepGet(args, path, true);
                const propName = path.split('.').pop();
                const originalComponent = deepGet(args, path);

                if (!parent || !propName || typeof originalComponent !== 'function') {
                    return;
                }

                // Avoid wrapping the same component multiple times.
                if (originalComponent.__fbToolkitProxyWrapped) {
                    return;
                }

                const wrappedComponent = function (...componentArgs) {
                    const originalResult = originalComponent.apply(originalComponent, componentArgs);
                    const proxies = moduleProxies[moduleName] || [];
                    const activeProxy = proxies.find((p) => typeof p.component === 'function');
                    if (!activeProxy) {
                        return originalResult;
                    }

                    const requireFn = args[3];
                    const react = requireFn && requireFn('react');
                    if (!react || typeof react.jsx !== 'function') {
                        return originalResult;
                    }

                    try {
                        return react.jsx(react.Fragment, {
                            children: react.jsx(activeProxy.component, {
                                payload: componentArgs[0],
                                SourceCmp: originalResult,
                                lastCmp: originalResult,
                                definedArgs: args,
                                callingArgs: componentArgs
                            })
                        });
                    } catch (err) {
                        console.error(`[fb-toolkit] Proxy render failed for ${moduleName}:`, err);
                        if (typeof activeProxy.fallback === 'function') {
                            try {
                                return activeProxy.fallback(err, {
                                    payload: componentArgs[0],
                                    lastCmp: originalResult
                                });
                            } catch (fallbackErr) {
                                console.error(`[fb-toolkit] Proxy fallback failed for ${moduleName}:`, fallbackErr);
                            }
                        }
                        return originalResult;
                    }
                };

                wrappedComponent.__fbToolkitProxyWrapped = true;
                parent[propName] = wrappedComponent;
            });
        }
    };

    /**
     * Define the actual component replacement for a proxied module.
     * The component receives: { payload, SourceCmp, lastCmp, definedArgs, callingArgs }
     */
    window.defineModule = function (moduleName, component, options = {}) {
        if (!moduleProxies[moduleName]) {
            console.error(`[fb-toolkit] Undefined module proxy for ${moduleName}`);
            return;
        }

        const proxy = moduleProxies[moduleName][0];
        if (!proxy) {
            console.error(`[fb-toolkit] No proxy found for ${moduleName}`);
            return;
        }

        proxy.component = component;
        proxy.fallback = options.fallback;

    };

    // Register module proxies for ad-related components
    window.moduleProxyDefine('CometFeedUnitErrorBoundary.react');
    window.moduleProxyDefine('CometAdsSideFeedUnitItem.react');
    window.moduleProxyDefine('CometHomeRightRailUnit.react', { definerPath: '[6].default.render' });

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE HOOKS
    // ══════════════════════════════════════════════════════════════════════════

    // ── UNSEEN: Block Read Receipts ───────────────────────────────────────────

    // Hook 1: Replace markThreadAsRead with a no-op
    registerStringReplacement(
        'lppcfdbg.spg.offtov}topjujojgfEcpKXBN',
        (src) => src.replace(/markThreadAsRead:function.*?\{/, 'markThreadAsRead:function(){return;')
    );

    // Hook 2: Intercept LSPlatformMarkThreadRead — return empty resolved promise
    registerExportListener('3WebfSebfsiUlsbNdjutjnjuqPTM', (args) => {
        if (args[4]?.exports) {
            if (args[4].exports.default) {
                const original = args[4].exports.default;
                args[4].exports.default = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            } else {
                const original = args[4].exports;
                args[4].exports = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            }
        }
    });

    // Hook 2b: Additional LSPlatformMarkThreadRead variant (Impm)
    registerExportListener('mqnJ3WebfSebfsiUlsbNdjutjnjuqPTM', (args) => {
        if (args[4]?.exports) {
            if (args[4].exports.default) {
                const original = args[4].exports.default;
                args[4].exports.default = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            } else {
                const original = args[4].exports;
                args[4].exports = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            }
        }
    });

    // Hook 2c: Yet another LSPlatformMarkThreadRead variant (WebImpm)
    registerExportListener('cfXmqnJ3WebfSebfsiUlsbNdjutjnjuqPTM', (args) => {
        if (args[4]?.exports) {
            if (args[4].exports.default) {
                const original = args[4].exports.default;
                args[4].exports.default = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            } else {
                const original = args[4].exports;
                args[4].exports = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_READ;
                    if (settings?.enable) {
                        const deferred = fnArgs[fnArgs.length - 1];
                        return deferred.resolve([]);
                    }
                    return original.apply(original, fnArgs);
                });
            }
        }
    });

    // ── UNSEEN: Block Typing Indicator ────────────────────────────────────────

    // Hook 1: Replace sendChatStateFromComposer with "none" to prevent typing signals
    registerStringReplacement(
        'lppcfdbg.spg.offtov}fubuThojqzUfsvdfTXBN',
        (src) => src.replaceAll('sendChatStateFromComposer', 'none')
    );

    // Hook 2: Intercept the typing indicator sender module
    registerExportListener('spubdjeoJhojqzUeofTTM', (args) => {
        if (args[4]?.exports) {
            if (args[4].exports.default) {
                const original = args[4].exports.default;
                args[4].exports.default = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_TYPING;
                    // Set the "should send" parameter to false when blocking is enabled
                    fnArgs[2] = !(settings?.enable);
                    return original.apply(original, fnArgs);
                });
            } else {
                const original = args[4].exports;
                args[4].exports = wrapFunction(original, function (...fnArgs) {
                    const settings = window?.fb_toolkit?.unseen?.DISABLE_TYPING;
                    fnArgs[2] = !(settings?.enable);
                    return original.apply(original, fnArgs);
                });
            }
        }
    });

    // ── UNSEEN: Anonymous Story Viewing ───────────────────────────────────────

    // Replace onCardSeen callback with empty function when enabled
    registerStringReplacement(
        'lppcfdbg.spg.offtov}udbfs/sfojbuopDufldvCftofqtvTtfjspuT',
        (src) => src.replace(
            /,onCardSeen:(\w+),/g,
            ',onCardSeen:window?.fb_toolkit?.unseen?.DISABLE_STORIES_SEEN?.enable ? ()=>{} : $1,'
        )
    );

})();
