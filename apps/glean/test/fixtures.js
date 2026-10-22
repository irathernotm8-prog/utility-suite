// Trimmed copies of the shapes each site's own API returns (field names match the real responses).
const ig = (name, w) => ({ url: `https://scontent.cdninstagram.com/v/t51.2885-15/${name}?stp=dst-jpg_p${w}x${w}&w=${w}`, width: w, height: Math.round(w * 1.25) });
const cands = (name) => ({ candidates: [ig(name, 1440), ig(name, 640), ig(name, 320)].map((c, i) => i === 0 ? { ...c, url: c.url.replace('?', '?s=1440&') } : c) });

exports.igFeed = {
  items: [
    {
      code: 'CAR0USEL1', pk: '1', id: '1_99', taken_at: 1760000000, media_type: 8, product_type: 'carousel_container',
      user: { username: 'clientbrand', full_name: 'Client Brand' }, caption: { text: 'Fall launch ✨ #new' },
      carousel_media: [
        { id: 'c1', media_type: 1, image_versions2: cands('4567890123_n.jpg') },
        { id: 'c2', media_type: 1, image_versions2: cands('5678901234_n.jpg') },
        { id: 'c3', media_type: 2, image_versions2: cands('6789012345_n.jpg'), video_versions: [{ url: 'https://scontent.cdninstagram.com/o1/v/t16/f2/m86/AQ_vid720.mp4?x=0', width: 720, height: 1280 }, { url: 'https://scontent.cdninstagram.com/o1/v/t16/f2/m86/AQ_vid1080.mp4?x=1', width: 1080, height: 1920 }] }
      ]
    },
    {
      code: 'REEL1', pk: '2', taken_at: 1759000000, media_type: 2, product_type: 'clips', user: { username: 'clientbrand' }, caption: null,
      image_versions2: cands('7890123456_n.jpg'), video_versions: [{ url: 'https://scontent.cdninstagram.com/o1/v/reel1080.mp4', width: 1080, height: 1920 }]
    }
  ],
  user: { username: 'clientbrand', profile_pic_url: 'https://scontent.cdninstagram.com/v/t51.2885-19/pp_123456789.jpg' }
};

exports.igGraph = {
  data: { user: { edge_owner_to_timeline_media: { edges: [{ node: {
    shortcode: 'SIDE1', taken_at_timestamp: 1700000000, owner: { username: 'clientbrand' }, display_url: 'https://scontent.cdninstagram.com/v/a/1111111111_n.jpg',
    dimensions: { width: 1080, height: 1080 }, edge_media_to_caption: { edges: [{ node: { text: 'Old style' } }] },
    edge_sidecar_to_children: { edges: [
      { node: { display_url: 'https://scontent.cdninstagram.com/v/a/2222222222_n.jpg', dimensions: { width: 1080, height: 1080 } } },
      { node: { display_url: 'https://scontent.cdninstagram.com/v/a/3333333333_n.jpg', dimensions: { width: 1080, height: 1350 }, is_video: true, video_url: 'https://scontent.cdninstagram.com/v/a/side_vid_44444.mp4' } }
    ] }
  } }] } } }
};

exports.patreon = {
  data: [
    { id: '111', type: 'post', attributes: { title: 'WIP pack', content: '<p>Hello patrons</p>', published_at: '2026-09-01T10:00:00.000+00:00', url: '/posts/wip-pack-111', post_type: 'image_file' },
      relationships: { images: { data: [{ id: 'm1', type: 'media' }, { id: 'm2', type: 'media' }] }, campaign: { data: { id: '9', type: 'campaign' } } } },
    { id: '222', type: 'post', attributes: { title: 'Process video', published_at: '2026-08-01T10:00:00.000+00:00', url: 'https://www.patreon.com/posts/process-222' },
      relationships: { attachments_media: { data: [{ id: 'm3', type: 'media' }] }, campaign: { data: { id: '9', type: 'campaign' } } } },
    { id: '333', type: 'post', attributes: { title: 'Locked', current_user_can_view: false, url: '/posts/locked-333' }, relationships: { campaign: { data: { id: '9', type: 'campaign' } } } }
  ],
  included: [
    { id: '9', type: 'campaign', attributes: { name: 'Artist Name', url: 'https://www.patreon.com/artist' } },
    { id: 'm1', type: 'media', attributes: { mimetype: 'image/png', file_name: 'sheet1.png', image_urls: { original: 'https://c10.patreonusercontent.com/4/patreon-media/p/post/111/original/eyJ1Ijo1/1.png?token=a', thumbnail: 'https://c10.patreonusercontent.com/thumb/1.png' }, metadata: { dimensions: { w: 3000, h: 2000 } } } },
    { id: 'm2', type: 'media', attributes: { mimetype: 'image/jpeg', file_name: 'sheet2.jpg', image_urls: { original: 'https://c10.patreonusercontent.com/4/patreon-media/p/post/111/original/eyJ1Ijo2/2.jpg?token=b' } } },
    { id: 'm3', type: 'media', attributes: { mimetype: 'video/mp4', file_name: 'process.mp4', download_url: 'https://www.patreon.com/media-u/abcdefabcdef123456' } }
  ]
};

const fbStory = { __typename: 'Story', post_id: 'S1', creation_time: 1760500000, url: 'https://www.facebook.com/clientpage/posts/S1',
  comet_sections: { content: { story: { message: { text: 'Grand opening!' }, actors: [{ name: 'Client Page', url: 'https://www.facebook.com/clientpage' }] } } },
  attachments: [{ media: { __typename: 'Photo', id: 'P1', image: { uri: 'https://scontent.fhou1-1.fna.fbcdn.net/v/t39/1234567890123_n.jpg?a=small', width: 600, height: 400 },
    viewer_image: { uri: 'https://scontent.fhou1-1.fna.fbcdn.net/v/t39/1234567890123_n.jpg?a=big', width: 2048, height: 1365 } } },
  { media: { __typename: 'Video', id: 'V1', playable_url: 'https://video.fbcdn.net/sd.mp4', playable_url_quality_hd: 'https://video.fbcdn.net/hd_98765.mp4', width: 1920, height: 1080 } }] };
exports.fbText = 'for (;;);' + JSON.stringify({ data: { node: { timeline: { edges: [{ node: fbStory }] } } } }) + '\n' + JSON.stringify({ label: 'x', data: { other: 1 } });

exports.x = { data: { user: { result: { timeline: { instructions: [{ entries: [{ content: { itemContent: { tweet_results: { result: {
  __typename: 'Tweet', rest_id: '42', core: { user_results: { result: { legacy: { screen_name: 'Brand' } } } },
  legacy: { id_str: '42', full_text: 'New drop https://t.co/abc', created_at: 'Wed Oct 01 12:00:00 +0000 2025', extended_entities: { media: [
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/GaBcDeF123.jpg', original_info: { width: 4096, height: 2731 } },
    { type: 'video', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg', original_info: { width: 1920, height: 1080 }, video_info: { variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl.m3u8' }, { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/vid/640x360/a.mp4' }, { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.com/vid/1920x1080/b.mp4' }] } }
  ] } } } } } } }] }] } } } } };
