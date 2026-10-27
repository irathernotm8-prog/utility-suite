// Design sizes, by where they're going. Pixels unless noted; print sizes are at 300 DPI.
export const SIZE_CATS = [
  { id: 'social', name: 'Social media', icon: 'share-2', items: [
    ['Instagram post', 1080, 1080], ['Instagram portrait', 1080, 1350], ['Instagram story', 1080, 1920], ['Reel / TikTok cover', 1080, 1920],
    ['Facebook post', 1200, 630], ['Facebook cover', 1640, 624], ['Facebook event', 1920, 1005], ['X post', 1600, 900], ['X header', 1500, 500],
    ['LinkedIn post', 1200, 1200], ['LinkedIn banner', 1584, 396], ['Pinterest pin', 1000, 1500], ['Threads post', 1080, 1350],
  ] },
  { id: 'video', name: 'Video & streaming', icon: 'clapperboard', items: [
    ['YouTube thumbnail', 1280, 720], ['YouTube banner', 2560, 1440], ['Video 1080p', 1920, 1080], ['Video 4K', 3840, 2160], ['Vertical video', 1080, 1920], ['Twitch panel', 320, 160],
  ] },
  { id: 'ads', name: 'Ads & web', icon: 'megaphone', items: [
    ['Meta feed ad', 1080, 1080], ['Meta story ad', 1080, 1920], ['Google display (landscape)', 1200, 628], ['Leaderboard', 728, 90], ['Medium rectangle', 300, 250],
    ['Skyscraper', 160, 600], ['Blog banner', 1200, 600], ['Email header', 600, 200], ['Website hero', 1920, 1080], ['Open Graph image', 1200, 630],
  ] },
  { id: 'print', name: 'Print', icon: 'printer', items: [
    ['A4 portrait', 2480, 3508, 'A4'], ['A4 landscape', 3508, 2480, 'A4'], ['US Letter', 2550, 3300, 'Letter'], ['A5 flyer', 1748, 2480, 'A5'], ['Poster 18×24 in', 5400, 7200, '18×24 in'],
    ['Postcard 6×4 in', 1800, 1200, '6×4 in'], ['Business card', 1050, 600, '3.5×2 in'], ['Invitation 5×7 in', 1500, 2100, '5×7 in'], ['Square sticker 3 in', 900, 900, '3 in'],
  ] },
  { id: 'docs', name: 'Presentations & docs', icon: 'presentation', items: [
    ['Presentation 16:9', 1920, 1080], ['Presentation 4:3', 1440, 1080], ['Infographic', 800, 2000], ['Logo', 500, 500], ['Phone wallpaper', 1179, 2556], ['Desktop wallpaper', 2560, 1440],
  ] },
  { id: 'ratio', name: 'Aspect ratios', icon: 'ratio', items: [
    ['1:1 square', 1080, 1080], ['4:5', 1080, 1350], ['3:4', 1080, 1440], ['2:3', 1080, 1620], ['9:16', 1080, 1920], ['16:9', 1920, 1080], ['3:2', 1620, 1080], ['4:3', 1440, 1080], ['21:9', 2520, 1080], ['2:1', 2000, 1000],
  ] },
];
export const QUICK_SIZES = [['Instagram post', 1080, 1080], ['Instagram story', 1080, 1920], ['YouTube thumbnail', 1280, 720], ['Facebook post', 1200, 630], ['Presentation', 1920, 1080], ['A4 flyer', 2480, 3508], ['LinkedIn banner', 1584, 396], ['Logo', 500, 500]];
export const UNITS = { px: 1, in: 300, cm: 300 / 2.54, mm: 300 / 25.4 };
