import path from 'path'
import EventEmitter from 'events'

import E from '../lib/error'

import { forceDriveXstatAsync } from './xstat'
import { mkdirpAsync } from '../util/async'
import Node from './node'
import DriveNode from './driveNode'
import FileNode from './fileNode'
import DirectoryNode from './directoryNode'

class FileData extends EventEmitter {

  constructor(driveDir, model) {
    super()
    this.dir = driveDir
    this.model = model
    this.root = new Node(this)
    this.uuidMap = new Map()
    this.probeTotal = 0
    this.probeNow = 0
    

    // drives created and deleted are processed in batch
    // it is easier to do assertion after change
    model.on('drivesCreated', drives => this.createDrives(drives))

    model.on('drivesDeleted', drives => this.deleteDrives(drives))

    model.on('driveUpdated', drive => this.updateDriveAsync(drive))
  }

  createDrives(drives) {
    drives.forEach(async drv => {
      let target = path.join(this.dir, drv.uuid)
      await mkdirpAsync(target)
      let xstat = await forceDriveXstatAsync(target, drv.uuid)
      let drvNode = new DriveNode(this, xstat, drv)
      drvNode.attach(this.root)
    })
  }

  deleteDrives(drives) {
    this.root.getChilren
        .filter(node => drives.map(d => d.uuid).includes(node.uuid))
        .forEach(node => node.detach())
  }

  async updateDriveAsync(drive) {
    let node = this.root.getChildren().find(n => n.uuid === drive.uuid)
    if(node) node.updateDrive(drive)
  }

  nodeAttached(node) {
    this.uuidMap.set(node.uuid, node)
  }

  nodeDetaching(node) {
    this.uuidMap.delete(node.uuid)
  }

  probeStarted(node) {
    this.probeTotal++
    this.probeNow++
    console.log(`node ${node.uuid} ${node.name} probe started`)
  }

  probeStopped(node) {
    this.probeNow--
    console.log(`node ${node.uuid} ${node.name} probe stopped`)
  }

  hashStarted(node) {
    console.log(`node ${node.uuid} ${node.name} hash started`)
  }

  hashStopped(node) {
    console.log(`node ${node.uuid} ${node.name} hash stopped`)
  }

  identifyStarted(node) {
    console.log(`node ${node.uuid} ${node.name} identify started`)
  }

  identifyStopped(node) {
    console.log(`node ${node.uuid} ${node.name} identify stopped`)
  }

  // create node does NOT probe parent automatically,
  // the probe should be put in caller's try / finally block 
  createNode(parent, xstat) {

    let node

    switch(xstat.type) {
      case 'directory':
        node = new DirectoryNode(this, xstat)
        break
      case 'file':
        node = new FileNode(this, xstat)
        break
      default:
        throw 'bad xstat' //TODO
    } 

    // this.uuidMap.set(uuid, node)
    node.attach(parent)
    return node.uuid
  }

  // update means props changed
  updateNode(node, xstat) {
    node.update(xstat)
  }

  deleteNode(node) {
    node.postVisit(n => {
      n.detach()
      // this.uuid...
    })
  }

  deleteNodeByUUID(uuid) {
  }

  findNodeByUUID(uuid) {
    return this.uuidMap.get(uuid)
  }

  // this function is permissive
  requestProbeByUUID(uuid) {

    let node = this.findNodeByUUID(uuid)
    if (!node) return
    if (!node.isDirectory()) return // TODO maybe we should throw
    node.probe()
  }

  userPermittedToRead(userUUID, node) {

    let drive = node.getDrive()
    switch (drive.type) {
    case 'private':
      return userUUID === drive.owner
    case 'public':
      return drive.writelist.includes(userUUID) || drive.readlist.includes(userUUID)
    default:
      throw new Error('invalid drive type', drive)
    }
  }

  userPermittedToReadByUUID(userUUID, nodeUUID) {
    
    let node = this.findNodeByUUID(nodeUUID)
    if (!node) throw new E.ENODENOTFOUND()
    return this.userPermittedToRead(userUUID, node)
  }

  userPermittedToWrite(userUUID, node) {

    let drive = node.getDrive()
    switch (drive.type) {
    case 'private':
      return userUUID === drive.owner
    case 'public':
      return drive.writelist.includes(userUUID)
    default:
      throw new Error('invalid drive type', drive)
    }
  }

  userPermittedToWriteByUUID(userUUID, nodeUUID) {

    let node = this.findNodeByUUID(nodeUUID)
    if (!node) throw new E.ENODENOTFOUND()
    return this.userPermittedToWrite(userUUID, node)
  }

  userPermittedToShare(userUUID, node) {

    let drive = node.getDrive()
    switch (drive.type) {
    case 'private':
      return userUUID === drive.owner
    case 'public':
      return drive.shareAllowed
    default:
      throw new Error('invalid drive type', drive)
    }
  }
  
  userPermittedToShareByUUID(userUUID, nodeUUID) {

    let node = this.findNodeByUUID(nodeUUID)
    if (!node) throw new E.ENODENOTFOUND()
    return this.userPermittedToShare(userUUID, node)
  }

  fromUserHome(userUUID, node) {
    let drive = node.getDrive()
    return drive.owner === userUUID && drive.ref === 'home'
  }

  fromUserLibrary(userUUID, node) {
    let drive = node.getDrive()
    return drive.owner === userUUID && drive.ref === 'library'
  }

  fromUserService(userUUID, node) {
    let drive = node.getDrive()
    return drive.owner === userUUID && drive.ref === 'service'
  }
  
  print() {
    /**
    let q = {}
    this.root.preVisit(node => q.push({name: node.name}))
    return q
    **/
    return this.root.genObject()
  }
}

export default FileData

