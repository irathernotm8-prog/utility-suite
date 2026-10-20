// Facebook Page + linked Instagram posting. Nothing to sync; this connection just holds the Page and a token that can post.
// A System User token is the durable choice. Needed permissions: pages_manage_posts, pages_read_engagement, pages_show_list,
// instagram_basic, instagram_content_publish (and business_management if the Page sits in a Business Manager).
const { pageContext } = require('../publisher');

module.exports = {
  kind: 'meta-pages', name: 'Facebook & Instagram posting', category: 'publishing', status: 'ready',
  fields: [
    { key: 'pageId', label: 'Facebook Page ID', placeholder: 'Numbers only; Page → About → Page transparency' },
    { key: 'token', label: 'Access token (with posting permissions)', secret: true, placeholder: 'System user token or Page token' }
  ],
  async test(cfg, fetchImpl = fetch) {
    const c = await pageContext(cfg, fetchImpl);
    return { ok: true, detail: `${c.name}${c.igUser ? ' · Instagram @' + c.igUser : ' · no Instagram account linked'}` };
  },
  async sync() { return {}; }
};
