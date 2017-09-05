import path from 'path'
import { fs, child, rimrafAsync, mkdirpAsync } from '../../../common/async'
import Debug from 'debug'
const DOCKER = Debug('APPIFI:DOCKER')

import request from 'superagent'

import { storeState, storeDispatch } from '../../lib/reducers'
import { containerStart, containerStop, containerCreate, containerDelete } from './dockerApi'
import { refreshAppstore } from '../appstore/appstore' // TODO
import { dockerEventsAgent, DockerEvents } from './dockerEvents'
import DockerStateObserver from './dockerStateObserver'
import { AppInstallTask } from './dockerTasks'
import { calcRecipeKeyString, appMainContainer, containersToApps } from '../../lib/utility'

import Promise from 'bluebird'

let dockerPidFile = null
let rootDir = null
let appDataDir = null
let execRootDir = null
let graphDir = null
let dockerStatus = {}

/**
  docker daemon requires two base directories to work
  1. /run/dockerMarket/app to store docker.pid file
  2. [rootdir]/ (tailing with dockerMarket for volumes)
        // forexample: /run/dockerMarket/volumes/xxxx/dockerMarket
      r for exec root
      g for graph
      appdata for docker volume
**/
const prepareDirs = async (dir) => {

  dockerPidFile = path.join(dir, 'docker.pid')

  rootDir = dir
  appDataDir = path.join(rootDir, 'appdata')
  execRootDir = path.join(rootDir, 'r')
  graphDir = path.join(rootDir, 'g')

  await mkdirpAsync(appDataDir) 
  await mkdirpAsync(execRootDir)
  await mkdirpAsync(graphDir)

  DOCKER('Create: ' + dockerPidFile)
  console.log('Create: ' + dockerPidFile)
  await fs.openAsync(dockerPidFile, 'w', (err) => { DOCKER('Create pid file failed: ' + err) })
}

const probeDaemonGraphDir = (callback) => 
  request
    .get('http://localhost:1688/info')
    .set('Accept', 'application/json')
    .end((err, res) => {
      if (err) return callback(err)
      if (!res.ok) return callback(new Error('request res not ok'))
      callback(null, res.body.DockerRootDir)
    })

const probeDaemonGraphDirAsync = Promise.promisify(probeDaemonGraphDir)

const startDockerEvents = async () => {

  let agent = await dockerEventsAgent()
  let events = new DockerEvents(agent)

  events.on('update', state => {

    let oldState = storeState().docker
    storeDispatch({
      type: 'DOCKER_UPDATE',
      data: {
        data: state,
        computed: {
          installeds: containersToApps(state.containers)
        }
      }
    })

    let newState = storeState().docker
    let dockerStateObserver = new DockerStateObserver()
    dockerStateObserver.observe(newState, oldState) 
  })

  events.on('end', () => {
    storeDispatch({
      type: 'DAEMON_STOP'
    })
  })

  storeDispatch({
    type: 'DAEMON_START',
    data: { root: graphDir, events }
  }) 
}

const daemonStart = async () => {

  let out = fs.openSync('/dev/null', 'w')
  let err = fs.openSync('/dev/null', 'w')

  let opts = {
    detached: true, 
    stdio: ['ignore', out, err]
  }
 
  let args = [
    'daemon', 
    `--exec-root=${execRootDir}`,
    `--graph=${graphDir}`,
    '--host=127.0.0.1:1688',  
    `--pidfile=${dockerPidFile}`
  ]

  let dockerDaemon = child.spawn('docker', args, opts)

  dockerDaemon.on('error', err => {
    
    DOCKER('dockerDaemon error >>>>')
    console.log('dockerDaemon error >>>>')
    DOCKER(err)
    console.log(err)
    DOCKER('dockerDaemon error <<<<')
    console.log('dockerDaemon error <<<<')
  })

  dockerDaemon.on('exit', (code, signal) => {
    console.log('aaaaaa')
    dockerDaemon = null
    if (code !== undefined) DOCKER(`Daemon exits with exitcode ${code}`)
    console.log('bbbbbb')
    DOCKER(args)
    console.log(args)
    if (signal !== undefined) DOCKER(`Daemon exits with signal ${signal}`)
  })

  // await Promise.delay(3000)
  // console.log(dockerDaemon)

  console.log('cccccc')

  // if (dockerDaemon === null) throw 'docker daemon stopped right after started'
  // dockerDaemon.unref()

  console.log('dddddd')

  await startDockerEvents()
  DOCKER('Events listener started')
  console.log('Events listener started')
  refreshAppstore()
  DOCKER('Appstore reloading')
  console.log('Appstore reloading')

  dockerStatus.status = 'Started'
}

const daemonStopCmd = `start-stop-daemon --stop --pidfile ${dockerPidFile} --retry 3`

const daemonStop3 = callback => 
  child.exec(daemonStopCmd, (err, stdout, stderr) => {
    if (err){
      DOCKER('DaemonStop:', err, stdout, stderr)
      console.log('DaemonStop:', err, stdout, stderr)
    }
    else {
      DOCKER('DaemonStop: success')
      console.log('DaemonStop: success')   
    }      
    
    dockerStatus.status = 'Stopped'

    callback(err)
  })

const daemonStop = Promise.promisify(daemonStop3)

const initAsync = async (dir) => {

  dockerStatus.status = 'Initialized'

  DOCKER('docker init dir: ', dir)
  console.log('docker init dir: ', dir)

  await prepareDirs(dir)

  DOCKER('Root of the Docker runtime: ', graphDir)
  console.log('Root of the Docker runtime: ', graphDir)
  DOCKER('Root directory for execution state files: ', execRootDir)
  console.log('Root directory for execution state files: ', execRootDir)

  let probedGraphDir
  try { 
    probedGraphDir = await probeDaemonGraphDirAsync() 
  } catch (e) {}

  DOCKER('Probed graph dir: ', probedGraphDir)
  console.log('Probed graph dir: ', probedGraphDir)

  if (probedGraphDir === graphDir) {
    DOCKER(`Daemon already started @ ${rootDir}`)
    console.log(`Daemon already started @ ${rootDir}`)
  }
  else {

    if (probedGraphDir) {
      DOCKER(`Another daemon already started (graphDir) @ {probedGraphDir}, try stopping it`)
      console.log(`Another daemon already started (graphDir) @ {probedGraphDir}, try stopping it`)
      await daemonStop()
      await Promise.delay(1000)
    }

    DOCKER(`Starting daemon @ ${rootDir}`)
    console.log(`Starting daemon @ ${rootDir}`)
    await daemonStart()
  }

  await startDockerEvents()
  DOCKER('Events listener started')
  console.log('Events listener started')
  refreshAppstore()
  DOCKER('Appstore reloading')
  console.log('Appstore reloading')
}

function appStatus(recipeKeyString) {

  let state = storeState()
  
  if (state.docker === null || 
      state.docker.data === null ||
      state.docker.data.containers === null ||
      state.docker.computed === null ||
      (!state.docker.computed.installeds))
  { return 'UNAVAIL' }

  let installeds = state.docker.computed.installeds

  let inst = installeds.find(i => i.recipeKeyString === recipeKeyString)
  if (inst) return 'INSTALLED'

  let tasks = state.tasks
  let task = tasks.find(t => t.type === 'appInstall' && t.id === recipeKeyString && t.status === 'started')
  if (task) return 'INSTALLING'

  return 'NOTFOUND'
}

async function appInstall(recipeKeyString) {

  // check if installed or installing
  let status = appStatus(recipeKeyString)
  if (status !== 'NOTFOUND') {
    DOCKER(`${recipeKeyString} status: ${status}, install rejected`)
    console.log(`${recipeKeyString} status: ${status}, install rejected`)
    return
  } 

  // retrieve recipe
  let appstore = storeState().appstore.result
  if (!appstore || !appstore.recipes) {
    DOCKER(`recipes unavail, failed to install ${appname} (${recipeKeyString})`)
    console.log(`recipes unavail, failed to install ${appname} (${recipeKeyString})`)
    return
  }

  let recipe = appstore.recipes.find(r => calcRecipeKeyString(r) === recipeKeyString)
  if (!recipe) {
    DOCKER(`recipe not found: ${recipeKeyString}, install app failed`)
    console.log(`recipe not found: ${recipeKeyString}, install app failed`)
    return
  }

  // remove existing tasks if any
  let tasks = storeState().tasks
  let stopped = tasks.filter(t => t.type === 'appInstall' && t.id === recipeKeyString && t.status === 'stopped')
  stopped.forEach(t => {
    storeDispatch({
      type: 'TASK_REMOVE',
      task: {
        type: 'appInstall',
        id: recipeKeyString 
      }   
    })
  })

  // create task
  let task = new AppInstallTask(recipe, appDataDir)
  storeDispatch({
    type: 'TASK_ADD',
    task    
  })
}

async function daemonStartOp(uuid) {

  if (storeState().docker) 
    throw new Error('daemon already started') 

  // let storage = storeState().storage
  // let volume = storage.volumes.find(vol => vol.uuid === uuid)
  // if (!volume)
  //   throw new Error('volume not found')
  // if (volume.missing)
  //   throw new Error('volume missing')

  // await daemonStart(volume.uuid)
  await daemonStart()
}

async function containerDeleteCommand(id) {

  let docker = storeState().docker
  if (!docker || !docker.computed || !docker.computed.installeds) return null

  let installeds = docker.computed.installeds

  DOCKER('>>>>')
  console.log('>>>>')
  installeds.forEach(inst => DOCKER(inst.containers))
  DOCKER('<<<<')
  console.log('<<<<')

  let inst = installeds.find(i => {
    return i.containers.find(c => c.Id === id) ? true : false
  })  

  if (inst) {
    DOCKER(`container in apps cannot be deleted directly`)
    console.log(`container in apps cannot be deleted directly`)
    return null
  }

  containerDelete(id)
    .then(r => {
      DOCKER(`containerDelete ${id} success`, r)
      console.log(`containerDelete ${id} success`, r)
    })
    .catch(e => {
      DOCKER(`containerDelete ${id} failed, error: ${e.errno} ${e.message}`)
      console.log(`containerDelete ${id} failed, error: ${e.errno} ${e.message}`)
    })
}

async function installedStart(uuid) {

  DOCKER(`installedStart uuid: ${uuid}`)
  console.log(`installedStart uuid: ${uuid}`)

  let state = storeState()
  
  if (state.docker === null || 
      state.docker.data === null ||
      state.docker.data.containers === null ||
      state.docker.computed === null ||
      (!state.docker.computed.installeds))
    return { errno: -1 }

  let installeds = state.docker.computed.installeds
  let installed = installeds.find(inst => inst.uuid === uuid)
  if (!installed) return { errno: -1 }

  let container = appMainContainer(installed)
  if (container && container.Id) {
    await containerStart(container.Id)
  } 
}

async function installedStop(uuid) {

  DOCKER(`installedStop uuid: ${uuid}`)
  console.log(`installedStop uuid: ${uuid}`)

  let state = storeState()
  
  if (state.docker === null || 
      state.docker.data === null ||
      state.docker.data.containers === null ||
      state.docker.computed === null ||
      (!state.docker.computed.installeds))
    return { errno: -1 }

  let installeds = state.docker.computed.installeds
  let installed = installeds.find(inst => inst.uuid === uuid)
  if (!installed) return { errno: -1 }

  let container = appMainContainer(installed)
  if (container && container.Id) {
    await containerStop(container.Id)
  }
}

async function appUninstall(uuid) {

  DOCKER(`appUninstall uuid: ${uuid}`)
  console.log(`appUninstall uuid: ${uuid}`)

  let state = storeState()
  
  if (state.docker === null || 
      state.docker.data === null ||
      state.docker.data.containers === null ||
      state.docker.computed === null ||
      (!state.docker.computed.installeds))
    return { errno: -1 }

  let installeds = state.docker.computed.installeds
  let installed = installeds.find(inst => inst.uuid === uuid)
  if (!installed) return { errno: -1 }

  let containers = installed.containers

  for (let i = 0; i < containers.length; i++) {
    await containerStop(containers[i].Id)
  } 

  for (let i = 0; i < containers.length; i++) {
    await containerDelete(containers[i].Id) 
  }
}

const getDockerStatus = () => {
  return dockerStatus
}

export default {

  init: (dir) => {
    initAsync(dir)
      .then(r => { // r undefined
       DOCKER(`Initialized`)
       console.log(`Initialized`)
      })
      .catch(e => {
        DOCKER('ERROR: init failed', e)
        console.log('ERROR: init failed', e)
      })
  },
}

export { 

  daemonStart, 
  daemonStop,
  daemonStartOp,

  containerStart,
  containerStop,
  containerDelete,

  installedStart,
  installedStop,

  appInstall,
  appUninstall,

  getDockerStatus,
}


