'use strict';
// Icon library for custom Favorites icons. 24×24 line icons drawn in one consistent style.
// Each entry: [id, label, category, keywords, svg body].
(function (g) {
  const L = [
    // General
    ['folder', 'Folder', 'General', 'files', '<path d="M3.5 7.5a2 2 0 012-2h3.8l2 2h7.2a2 2 0 012 2v7.5a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>'],
    ['folder-open', 'Open folder', 'General', 'files', '<path d="M3.5 17V7.5a2 2 0 012-2h3.8l2 2h6.2a2 2 0 012 2V11"/><path d="M3.5 17l2.2-5.3a1.5 1.5 0 011.4-.9H21l-2.6 6.4a1.5 1.5 0 01-1.4.9H5a1.5 1.5 0 01-1.5-1.1z"/>'],
    ['star', 'Star', 'General', 'favorite important', '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5 2.7 1-5.6-4-4 5.5-.8z"/>'],
    ['heart', 'Heart', 'General', 'love favorite', '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0112 6.9a4.2 4.2 0 017.5 2.6c0 5.6-7.5 10-7.5 10z"/>'],
    ['bookmark', 'Bookmark', 'General', 'saved', '<path d="M7 3.5h10a1 1 0 011 1v16l-6-3.8-6 3.8v-16a1 1 0 011-1z"/>'],
    ['pin', 'Pin', 'General', 'pinned', '<path d="M12 17v4M8 3.5h8l-1.2 6.2 3.2 3.3H6l3.2-3.3z"/>'],
    ['flag', 'Flag', 'General', 'mark', '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>'],
    ['tag', 'Tag', 'General', 'label', '<path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3a1.5 1.5 0 010 2.1l-6.2 6.2a1.5 1.5 0 01-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>'],
    ['inbox', 'Inbox', 'General', 'incoming', '<path d="M3.5 13.5l2.6-8a1.5 1.5 0 011.4-1h9a1.5 1.5 0 011.4 1l2.6 8V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 013.5 19z"/><path d="M3.5 13.5h4.8l1.2 2.5h5l1.2-2.5h4.8"/>'],
    ['archive', 'Archive', 'General', 'box storage old', '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M4.5 8.5V19a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5V8.5M10 12.5h4"/>'],
    ['box', 'Box', 'General', 'package shipping', '<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5"/>'],
    ['layers', 'Layers', 'General', 'stack', '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.5l9 4.8 9-4.8M3 16.5l9 4.8 9-4.8"/>'],
    ['sparkle', 'Sparkle', 'General', 'new magic ai', '<path d="M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'],
    ['clock', 'Clock', 'General', 'recent time', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
    ['trash', 'Trash', 'General', 'delete bin', '<path d="M4.5 7h15M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 001.5 1.5h7a1.5 1.5 0 001.5-1.5L18 7M9 7V4.5h6V7"/>'],
    ['lock', 'Lock', 'General', 'private secure', '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>'],
    ['key', 'Key', 'General', 'password access', '<circle cx="8" cy="15" r="4.5"/><path d="M11.3 11.7L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>'],
    ['shield', 'Shield', 'General', 'security backup', '<path d="M12 3.5l7.5 3v5.3c0 4.5-3.2 7.6-7.5 9.2-4.3-1.6-7.5-4.7-7.5-9.2V6.5z"/>'],
    // Work
    ['briefcase', 'Briefcase', 'Work', 'work job business', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a1.5 1.5 0 011.5-1.5h4A1.5 1.5 0 0115.5 5v2M3 12.5h18"/>'],
    ['doc', 'Document', 'Work', 'file paper', '<path d="M7 3.5h7l4 4V20a.5.5 0 01-.5.5h-10A.5.5 0 016 20V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>'],
    ['docs', 'Documents', 'Work', 'files papers', '<path d="M9 3.5h6.5l4 4V17a.5.5 0 01-.5.5H9a.5.5 0 01-.5-.5V4a.5.5 0 01.5-.5z"/><path d="M15.5 3.5V8h4M5.5 7v13a.5.5 0 00.5.5h9.5"/>'],
    ['clipboard', 'Clipboard', 'Work', 'tasks todo', '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4"/>'],
    ['chart', 'Chart', 'Work', 'report analytics data stats', '<path d="M4 20.5h16M6.5 17V11M11 17V6.5M15.5 17v-4M20 17V8.5"/>'],
    ['pie', 'Pie chart', 'Work', 'report analytics', '<path d="M12 3.5v8.5h8.5A8.5 8.5 0 1112 3.5z"/><path d="M15 3.8a8.5 8.5 0 015.2 5.2H15z"/>'],
    ['trend', 'Trend', 'Work', 'growth ads marketing', '<path d="M3.5 17l6-6 4 4 7-7.5"/><path d="M15 7.5h5.5V13"/>'],
    ['megaphone', 'Megaphone', 'Work', 'marketing social ads campaign', '<path d="M4 10v4a1 1 0 001 1h2.5l7.5 4.5v-15L7.5 9H5a1 1 0 00-1 1z"/><path d="M8 15l1.2 5M18.5 9.5a3.5 3.5 0 010 5"/>'],
    ['calendar', 'Calendar', 'Work', 'schedule date', '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'],
    ['mail', 'Mail', 'Work', 'email inbox', '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>'],
    ['chat', 'Chat', 'Work', 'message', '<path d="M4 5.5h16a1 1 0 011 1v10a1 1 0 01-1 1h-9l-5 3.5v-3.5H4a1 1 0 01-1-1v-10a1 1 0 011-1z"/>'],
    ['receipt', 'Receipt', 'Work', 'invoice money tax', '<path d="M6 3.5h12V21l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'],
    ['dollar', 'Money', 'Work', 'finance budget bank', '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.4-1-1.5-1.6-2.8-1.6-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.6 5.8 4.4 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.7-3-1.8M12 6v1.6M12 16.4V18"/>'],
    ['bank', 'Bank', 'Work', 'finance', '<path d="M3.5 9.5L12 4l8.5 5.5M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3.5 20.5h17"/>'],
    ['users', 'People', 'Work', 'team clients group', '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.6-3.7 3.2-5.5 6.5-5.5s5.9 1.8 6.5 5.5"/><path d="M16 5.2a3.5 3.5 0 010 6.6M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>'],
    ['user', 'Person', 'Work', 'me profile personal', '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.7-4.2 3.6-6.5 7.5-6.5s6.8 2.3 7.5 6.5"/>'],
    ['id', 'ID card', 'Work', 'identity resume', '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.4-1.7 1.6-2.6 3.2-2.6s2.8.9 3.2 2.6M14.5 10h4M14.5 13.5h3"/>'],
    ['printer', 'Printer', 'Work', 'print scan', '<path d="M7 9V3.5h10V9M7 17H5a1.5 1.5 0 01-1.5-1.5v-5A1.5 1.5 0 015 9h14a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0119 17h-2"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>'],
    ['graduation', 'School', 'Work', 'education class study', '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.6 1.5 3.5 2.2 5.5 2.2s3.9-.7 5.5-2.2v-4.5M21.5 9.5V15"/>'],
    ['book', 'Book', 'Work', 'read library notes', '<path d="M4.5 5a1.5 1.5 0 011.5-1.5h12.5v14H6A1.5 1.5 0 004.5 19z"/><path d="M4.5 19A1.5 1.5 0 006 20.5h12.5v-3"/>'],
    ['pen', 'Pen', 'Work', 'write edit draft', '<path d="M15.5 4.5l4 4L8 20H4v-4z"/><path d="M13 7l4 4"/>'],
    ['lightbulb', 'Idea', 'Work', 'ideas brainstorm', '<path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 00-3.5 10.9c.4.3.5.8.5 1.3v1.8h6v-1.8c0-.5.1-1 .5-1.3A6 6 0 0012 3.5z"/>'],
    ['target', 'Target', 'Work', 'goals', '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'],
    ['trophy', 'Trophy', 'Work', 'win award', '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 5.5H4.5v1.5A3 3 0 008 10M16 5.5h3.5v1.5A3 3 0 0116 10M12 13v4M8.5 20.5h7M9.5 17.5h5"/>'],
    // Media & creative
    ['image', 'Photos', 'Media', 'pictures images', '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8.5"/>'],
    ['camera', 'Camera', 'Media', 'photos shoot', '<path d="M3.5 8.5a1.5 1.5 0 011.5-1.5h2.5l1.5-2.5h6L16.5 7H19a1.5 1.5 0 011.5 1.5V18a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 18z"/><circle cx="12" cy="13" r="3.6"/>'],
    ['video', 'Video', 'Media', 'movies clips', '<rect x="3.5" y="6" width="12.5" height="12" rx="2"/><path d="M16 10.5l4.5-2.5v8L16 13.5"/>'],
    ['film', 'Film', 'Media', 'movie cinema edit', '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M3.5 8h4M3.5 12h4M3.5 16h4M16.5 8h4M16.5 12h4M16.5 16h4"/>'],
    ['music', 'Music', 'Media', 'songs audio', '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>'],
    ['headphones', 'Headphones', 'Media', 'audio podcast', '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>'],
    ['mic', 'Microphone', 'Media', 'record podcast voice', '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>'],
    ['palette', 'Palette', 'Media', 'design art colors', '<path d="M12 3.5a8.5 8.5 0 000 17c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.2-1.6-1.2-2.8 0-1 .8-1.8 1.8-1.8H17a3.5 3.5 0 003.5-3.5c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.3" r="1"/><circle cx="15" cy="7.8" r="1"/>'],
    ['brush', 'Brush', 'Media', 'paint design art', '<path d="M20 4l-9 9M9.5 14.5c-2.4-.4-4.5 1.3-4.5 3.7 0 1-.6 1.8-1.5 2.3 3.6.6 7.2-.4 7.5-3.5z"/><path d="M11 13l1.8 1.8"/>'],
    ['shapes', 'Shapes', 'Media', 'design figma', '<circle cx="7.5" cy="7.5" r="4"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/><path d="M17 3.5l3.8 6.5h-7.6z"/>'],
    ['tv', 'TV', 'Media', 'shows watch', '<rect x="3" y="5.5" width="18" height="12" rx="2"/><path d="M8.5 21h7M9 2.5l3 3 3-3"/>'],
    ['gamepad', 'Games', 'Media', 'gaming play', '<path d="M7 7.5h10a4.5 4.5 0 014.4 5.4l-.7 3.6a2.6 2.6 0 01-4.6 1.1L14.5 15.5h-5L7.9 17.6a2.6 2.6 0 01-4.6-1.1l-.7-3.6A4.5 4.5 0 017 7.5z"/><path d="M7.5 10.5v3M6 12h3M15.5 11.5h.01M17.5 13h.01"/>'],
    ['ball', 'Football', 'Media', 'soccer sport', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5l3.3 2.4-1.3 3.9h-4L8.7 9.9zM12 7.5V3.5M15.3 9.9l3.9-1.3M14 13.8l2.4 3.4M10 13.8l-2.4 3.4M8.7 9.9L4.8 8.6"/>'],
    ['download', 'Download', 'Media', 'downloads', '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>'],
    ['upload', 'Upload', 'Media', 'share export', '<path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14"/>'],
    // Dev & tech
    ['code', 'Code', 'Dev', 'programming projects', '<path d="M8.5 8L4.5 12l4 4M15.5 8l4 4-4 4"/>'],
    ['terminal', 'Terminal', 'Dev', 'shell command', '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>'],
    ['git', 'Git', 'Dev', 'repo branch github', '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5v9M17.5 10.5c0 3.5-4 4-9.5 6.5"/>'],
    ['cpu', 'Chip', 'Dev', 'hardware computer', '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>'],
    ['database', 'Database', 'Dev', 'data storage sql', '<ellipse cx="12" cy="6" rx="7.5" ry="2.5"/><path d="M4.5 6v12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>'],
    ['server', 'Server', 'Dev', 'hosting backend', '<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>'],
    ['cloud', 'Cloud', 'Dev', 'icloud drive sync online', '<path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5A3.8 3.8 0 0117.5 18.5z"/>'],
    ['bolt', 'Bolt', 'Dev', 'fast power energy', '<path d="M13 3L5 13.5h6L10.5 21 19 10.5h-6z"/>'],
    ['bug', 'Bug', 'Dev', 'debug test', '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 016 0M12 11v9M3.5 13H7M17 13h3.5M4.5 8.5L7 10M19.5 8.5L17 10M4.5 18.5L7 17M19.5 18.5L17 17"/>'],
    ['wrench', 'Tools', 'Dev', 'settings fix utility', '<path d="M14.5 4a4.5 4.5 0 015.6 5.6l-2.2-2.2-2.4.5-.5 2.4 2.2 2.2A4.5 4.5 0 0111.6 7L4 14.6a2 2 0 002.8 2.8L14.4 9.8"/>'],
    ['gear', 'Gear', 'Dev', 'settings config', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
    ['apps', 'Apps', 'Dev', 'applications utility package', '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'],
    ['drive', 'Drive', 'Dev', 'disk external usb', '<rect x="3.5" y="13" width="17" height="6.5" rx="2"/><path d="M5.5 13l2-7.5h9l2 7.5"/><circle cx="16.5" cy="16.2" r=".7" fill="currentColor"/>'],
    ['desktop', 'Computer', 'Dev', 'desktop mac pc', '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8"/><path d="M9 20h6M12 16v4"/>'],
    ['phone', 'Phone', 'Dev', 'mobile iphone android', '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>'],
    ['robot', 'AI', 'Dev', 'robot bot assistant claude', '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 4.5v3M9 12.5h.01M15 12.5h.01M9.5 15.5h5M2.5 12v3M21.5 12v3"/>'],
    ['flask', 'Lab', 'Dev', 'test experiment science bench', '<path d="M9.5 3.5h5M10.5 3.5v5.5L5 18.5a1.5 1.5 0 001.3 2h11.4a1.5 1.5 0 001.3-2L13.5 9V3.5"/><path d="M7.5 14.5h9"/>'],
    // Places & travel
    ['home', 'Home', 'Places', 'house', '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19h4.5v-5h3v5H18V9.5"/>'],
    ['building', 'Office', 'Places', 'work company', '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M9 7.5h.01M15 7.5h.01M9 11.5h.01M15 11.5h.01M9 15.5h.01M15 15.5h.01M10.5 20.5v-3h3v3"/>'],
    ['globe', 'Globe', 'Places', 'web world internet', '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.7 5.4 3.7 8.5S14.5 17.9 12 20.5C9.5 17.9 8.3 15.1 8.3 12S9.5 6.1 12 3.5z"/>'],
    ['map', 'Map', 'Places', 'location travel', '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>'],
    ['location', 'Location', 'Places', 'pin place', '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0113 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'],
    ['plane', 'Travel', 'Places', 'trip flight vacation', '<path d="M10.5 13.5L4 11l1.5-1.5 7 .8 4.2-4.2a2 2 0 012.8 2.8l-4.2 4.2.8 7L14.5 21.5 12 15l-3 3v2.5L7.5 22l-1-3.5L3 17.5l1.5-1.5H7z"/>'],
    ['car', 'Car', 'Places', 'vehicle drive', '<path d="M5 16.5V12l1.8-4.5A1.5 1.5 0 018.2 6.5h7.6a1.5 1.5 0 011.4 1L19 12v4.5M3.5 12h17"/><rect x="3.5" y="12" width="17" height="5.5" rx="1.5"/><path d="M7 17.5v2M17 17.5v2M7 14.8h.01M17 14.8h.01"/>'],
    ['tree', 'Nature', 'Places', 'outdoors park', '<path d="M12 21v-5M12 3.5L6.5 11h3L6 15.5h12L14.5 11h3z"/>'],
    // Life & objects
    ['coffee', 'Coffee', 'Life', 'cafe morning', '<path d="M4.5 9.5h12v5a5 5 0 01-5 5h-2a5 5 0 01-5-5z"/><path d="M16.5 10.5h1.5a2.5 2.5 0 010 5h-1.6M8 3.5v2.5M11.5 3.5v2.5"/>'],
    ['cart', 'Shopping', 'Life', 'store buy orders', '<path d="M3.5 4h2l2.2 11.2a1.5 1.5 0 001.5 1.2h8.4a1.5 1.5 0 001.5-1.1L20.5 8H6.4"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>'],
    ['gift', 'Gift', 'Life', 'present birthday', '<rect x="4" y="9" width="16" height="11.5" rx="1"/><path d="M3 9h18v-2.5H3zM12 6.5v14M12 6.5c-1-2.6-4.6-3.6-5.2-1.6-.5 1.8 3.4 1.6 5.2 1.6zM12 6.5c1-2.6 4.6-3.6 5.2-1.6.5 1.8-3.4 1.6-5.2 1.6z"/>'],
    ['health', 'Health', 'Life', 'medical fitness vitals', '<path d="M3.5 12h4l2-4.5 3.5 9 2-4.5h5.5"/>'],
    ['dumbbell', 'Fitness', 'Life', 'gym workout', '<path d="M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11"/>'],
    ['food', 'Food', 'Life', 'recipes kitchen', '<path d="M6 3.5v7a2 2 0 002 2v8M10 3.5v7a2 2 0 01-2 2M8 3.5v6M16.5 20.5V3.5c-2 0-3.5 2.5-3.5 6v4h3.5"/>'],
    ['paw', 'Pets', 'Life', 'dog cat animal', '<circle cx="7" cy="10" r="1.8"/><circle cx="10.2" cy="6" r="1.8"/><circle cx="13.8" cy="6" r="1.8"/><circle cx="17" cy="10" r="1.8"/><path d="M12 11.5c-2.6 0-5.5 3.6-5.5 6 0 1.4 1 2.2 2.3 2.2 1.3 0 2-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.3-.8 2.3-2.2 0-2.4-2.9-6-5.5-6z"/>'],
    ['baby', 'Family', 'Life', 'kids family', '<circle cx="12" cy="12" r="8.5"/><path d="M9 11h.01M15 11h.01M9.5 15c1.4 1 3.6 1 5 0M10 3.8c0 1.5 1 2.2 2 2.2"/>'],
    ['sun', 'Sun', 'Life', 'summer day light', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'],
    ['moon', 'Moon', 'Life', 'night sleep dark', '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>'],
    ['flame', 'Flame', 'Life', 'hot fire trending', '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.7 3-5.5 3.8-9.3 2.6 1.7 3.3 4 3.2 5.8 1-.7 1.8-1.8 2-3.3 1.7 1.6 4 4.2 4 6.8 0 3.6-2.6 6.2-6.5 6.2z"/>'],
    ['leaf', 'Leaf', 'Life', 'eco green plants', '<path d="M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 15-14 15"/><path d="M5 19l7-7"/>'],
    ['rocket', 'Rocket', 'Life', 'launch ship start', '<path d="M12.5 15.5L8.5 11.5c1.6-4.7 5.5-8 11-8 0 5.5-3.3 9.4-8 11z"/><path d="M8.5 11.5H5l2.5-3.5h3.5M12.5 15.5V19l3.5-2.5V13M6.5 15.5c-1.5.5-2.5 2-2.5 4.5 2.5 0 4-1 4.5-2.5"/><circle cx="15" cy="9" r="1.5"/>'],
    ['puzzle', 'Puzzle', 'Life', 'plugin extension', '<path d="M5 8.5h3.2a2 2 0 113.6 0H15v3.3a2 2 0 110 3.4V18.5H11.8a2 2 0 10-3.6 0H5V15.2a2 2 0 100-3.4z"/>'],
    ['dice', 'Dice', 'Life', 'random fun', '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>'],
    ['crown', 'Crown', 'Life', 'vip best', '<path d="M3.5 8l4.5 4 4-6.5 4 6.5 4.5-4-1.7 10.5H5.2z"/>'],
    ['diamond', 'Gem', 'Life', 'premium valuable', '<path d="M6.5 4h11l3.5 5-9 11L3 9z"/><path d="M3 9h18M9.5 4L12 9l2.5-5M12 9v11"/>'],
  ];
  const G = {}, meta = [];
  for (const [id, label, cat, kw, body] of L) {
    G[id] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    meta.push({id, label, cat, kw: `${label} ${kw} ${id}`.toLowerCase()});
  }
  const SWATCHES = [['accent', 'Accent'], ['#3d7ff0', 'Blue'], ['#14a873', 'Green'], ['#0ea5b7', 'Teal'], ['#7c5cff', 'Violet'], ['#d946ef', 'Pink'], ['#e5484d', 'Red'], ['#ea7a22', 'Orange'], ['#d9a400', 'Yellow'], ['#8a8f98', 'Gray']];
  // Pick a sensible icon from a folder's name.
  function suggest(name) {
    const n = String(name || '').toLowerCase();
    const rules = [[/download/, 'download'], [/desktop/, 'desktop'], [/doc/, 'doc'], [/photo|picture|image|img|screenshot/, 'image'], [/music|song|audio|crate/, 'music'], [/movie|video|film|clip/, 'video'], [/project|code|dev|src|repo|git/, 'code'], [/work|job|client|business|office/, 'briefcase'], [/school|class|uni|study|course/, 'graduation'], [/tax|receipt|invoice|bill/, 'receipt'], [/money|finance|budget|bank|slate/, 'dollar'], [/design|art|creative|brand/, 'palette'], [/game/, 'gamepad'], [/travel|trip|vacation/, 'plane'], [/book|read|library/, 'book'], [/cloud|drive|dropbox|icloud/, 'cloud'], [/app|utility/, 'apps'], [/backup/, 'shield'], [/archive|old/, 'archive'], [/football|soccer|sport/, 'ball'], [/market|social|ads|campaign/, 'megaphone'], [/report|analytics|data/, 'chart'], [/home|house/, 'home'], [/resume|cv/, 'id'], [/note|idea/, 'lightbulb']];
    for (const [re, id] of rules) if (re.test(n)) return id;
    return 'folder';
  }
  g.Glyphs = {G, meta, SWATCHES, suggest, categories: [...new Set(L.map(x => x[2]))]};
})(globalThis);
