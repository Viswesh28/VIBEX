import {
  AlbumController,
  ArtistController,
  ContentController,
  PlaylistController,
  SearchController,
  SongController
} from './modules/index.js'
import { App } from './app.js'

const app = new App([
  new SearchController(),
  new SongController(),
  new AlbumController(),
  new ArtistController(),
  new PlaylistController(),
  new ContentController()
]).getApp()

export default app
