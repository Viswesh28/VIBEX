import { Endpoints } from '../../../../common/constants/index.js'
import { useFetch } from '../../../../common/helpers/index.js'
import { GetNewReleasesUseCase, GetTrendingSongsUseCase } from '../../../content/use-cases/index.js'
import { resolveFeedAlias } from '../../helpers/index.js'
import { createSongPayload } from '../../../songs/helpers/index.js'

export class SearchSongsUseCase {
  getTrendingSongsUseCase
  getNewReleasesUseCase

  constructor() {
    this.getTrendingSongsUseCase = new GetTrendingSongsUseCase()
    this.getNewReleasesUseCase = new GetNewReleasesUseCase()
  }

  async execute({ query, limit, page, languages, aliasEnabled = true }) {
    if (aliasEnabled) {
      const feed = await this.feedFor(query, limit, languages)
      if (feed) return feed
    }
    const { data } = await useFetch({
      endpoint: Endpoints.search.songs,
      params: {
        q: query,
        p: page,
        n: limit
      }
    })
    return {
      total: data.total,
      start: data.start,
      results: data.results?.map(createSongPayload).slice(0, limit) || []
    }
  }

  async feedFor(query, limit, languages) {
    const alias = resolveFeedAlias(query, languages)
    if (!alias) return null
    try {
      const results =
        alias.source === 'new-releases'
          ? await this.getNewReleasesUseCase.execute({ languages: alias.languages, limit })
          : await this.getTrendingSongsUseCase.execute({
              languages: alias.languages,
              sort: alias.sort,
              limit
            })
      if (!results.length) return null
      return { total: results.length, start: 0, results }
    } catch {
      return null
    }
  }
}
