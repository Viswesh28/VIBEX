import { Endpoints } from '../../../common/constants/index.js'
import { useFetch } from '../../../common/helpers/index.js'
import { createAlbumPayload } from '../../albums/helpers/index.js'
import { interleaveFeedItems, parseLanguages } from '../helpers/index.js'

export class GetNewAlbumsUseCase {
  async execute({ languages, limit = 20 } = {}) {
    const langs = Array.isArray(languages) ? languages : parseLanguages(languages)
    const settled = await Promise.allSettled(langs.map((language) => this.fetchLanguage(language)))
    const lists = settled
      .filter((r) => r.status === 'fulfilled' && r.value.length > 0)
      .map((r) => r.value)
    return interleaveFeedItems(lists, limit)
  }

  async fetchLanguage(language) {
    const [browseRes, trendingRes] = await Promise.allSettled([
      useFetch({ endpoint: Endpoints.modules, params: {}, cookie: `L=${language}` }),
      useFetch({
        endpoint: Endpoints.trending,
        params: { entity_type: 'album', entity_language: language },
        cookie: `L=${language}`
      })
    ])
    const raw = []
    if (browseRes.status === 'fulfilled' && browseRes.value.ok) {
      const mod = browseRes.value.data
      if (Array.isArray(mod?.new_albums)) {
        raw.push(...mod.new_albums.filter((item) => item?.type === 'album' && item?.id))
      }
    }
    if (trendingRes.status === 'fulfilled' && trendingRes.value.ok && Array.isArray(trendingRes.value.data)) {
      raw.push(...trendingRes.value.data.filter((item) => item?.id))
    }
    return raw.map(createAlbumPayload)
  }
}
