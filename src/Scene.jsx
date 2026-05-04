import Terrain from './components/Terrain'
import Environment from './components/Environment'
import City from './components/City'
import Traffic from './components/Traffic'
import NPCSystem from './components/NPCSystem'
import Player from './components/Player'
import PostProcessing from './components/PostProcessing'
import { CITY_DATA } from './utils/cityGenerator'

export default function Scene() {
  return (
    <>
      <Environment />
      <Terrain />
      <City data={CITY_DATA} />
      <Traffic roads={CITY_DATA.roads} />
      <NPCSystem buildings={CITY_DATA.buildings} roads={CITY_DATA.roads} />
      <Player />
      <PostProcessing />
    </>
  )
}
