import path from 'path'
import fs from 'fs'
import child from 'child_process'

import xattr from 'fs-xattr'
import UUID from 'node-uuid'
import validator from 'validator'

import E from '../lib/error'
import _ from '../lib/async'

import { isUUID, isSHA256 } from '../lib/types'

const isNonNullObject = obj => typeof obj === 'object' && obj !== null

// constants
const FRUITMIX = 'user.fruitmix'

// bump version when more file type supported
const UNINTERESTED_MAGIC_VERSION = 0

const parseMagic = text => text.startsWith('JPEG image data') 
  ? 'JPEG' 
  : UNINTERESTED_MAGIC_VERSION

const isMagicUpToDate = magic => 
  (Number.isInteger(magic) && magic >= UNINTERESTED_MAGIC_VERSION) 
    || magic === 'JPEG'

// it's fast, child.exec is sufficient
const fileMagic = (target, callback) => 
  child.exec(`file -b ${target}`, (err, stdout, stderr) => err 
    ? callback(err) 
    : callback(null, parseMagic(stdout.toString())))

const fileMagicAsync = Promise.promisify(fileMagic)

const readTimeStamp = (target, callback) =>
  fs.lstat(target, (err, stats) => err 
    ? callback(err) 
    : callback(null, stats.mtime.getTime()))

// async version of readXstat, simpler to implement than callback version
const readXstatAsync = async (target, raw) => {

  let dirty = false, attr

  // if this throws, target may be invalid
  let stats = await fs.lstatAsync(target)
  if (!stats.isDirectory() && !stats.isFile()) throw new E.ENOTDIRFILE()

  try {
    // may throw xattr ENOENT or JSON SyntaxError
    attr = JSON.parse(await xattr.getAsync(target, FRUITMIX))
  }
  catch (e) {
    // unexpected error
    if (e.code !== 'ENODATA' && !(e instanceof SyntaxError)) throw e 
  }

  if (attr) {
    // validate uuid
    if (!isUUID(attr.uuid)) {
      dirty = true
      attr.uuid = UUID.v4()
    }

    // validate hash and magic
    if (stats.isFile()) {

      if (attr.hasOwnProperty('hash') || attr.hasOwnProperty('htime')) { 
        if ( !isSHA256(attr.hash) 
          || !Number.isInteger(attr.htime) // is timestamp
          || attr.htime !== stats.mtime.getTime()) {
          dirty = true
          delete attr.hash
          delete attr.htime
        }
      }

      if (!isMagicUpToDate(attr.magic)) {
        dirty = true
        attr.magic = await fileMagicAsync(target)
      }
    }

    // remove old data TODO remove this code after a few months
    if ( attr.hasOwnProperty('owner')
      || attr.hasOwnProperty('writelist')
      || attr.hasOwnProperty('readlist')) {
      dirty = true 
      delete attr.owner
      delete attr.writelist
      delete attr.readlist
    }
  }
  else {
    dirty = true
    attr = { uuid: UUID.v4() }
    if (stats.isFile()) 
      attr.magic = await fileMagicAsync(target)
  }

  // save new attr if dirty
  if (dirty) await xattr.setAsync(target, FRUITMIX, JSON.stringify(attr)) 

  if (raw) return { stats, attr }

  let name = path.basename(target)
  let xstat
  if (stats.isDirectory()) {
    xstat = {
      uuid: attr.uuid,
      type: 'directory',
      name,
      mtime: stats.mtime.getTime()
    }
  } 
  else if (stats.isFile()) {
    xstat = {
      uuid: attr.uuid,
      type: 'file',
      name,
      mtime: stats.mtime.getTime(),
      size: stats.size,
      magic: attr.magic,
    } 
    if (attr.hash) xstat.hash = attr.hash
  }

  return xstat
}

// return attr only if hash is effective
const peekXattrAsync = async (target) => {
  let attr
  let stats = await fs.lstatAsync(target)
  if (!stats.isFile()) throw new E.ENOTFILE()

  try {
    // may throw xattr ENOENT or JSON SyntaxError
    attr = JSON.parse(await xattr.getAsync(target, FRUITMIX))
  }
  catch (e) {
    // unexpected error
    if (e.code !== 'ENODATA' && !(e instanceof SyntaxError)) throw e 
  }

  if (attr
    && attr.hasOwnProperty('hash')
    && isSHA256(attr.hash)
    && attr.htime === stats.mtime.getTime()) return attr
  else return 
}

const updateFileHashAsync = async (target, uuid, hash, htime) => {
  
  if (!isSHA256(hash) || !Number.isInteger(htime))
    throw new E.EINVAL()

  let { stats, attr } = await readXstatAsync(target, true)

  if (!stats.isFile()) throw new E.ENOTFILE()
  if (uuid !== attr.uuid) throw new E.EINSTANCE()
  if (htime !== stats.mtime.getTime()) throw new E.ETIMESTAMP()
  
  let attr2 = { uuid: attr.uuid, hash, htime, magic: attr.magic }
  await xattr.setAsync(target, FRUITMIX, JSON.stringify(attr2))

  let attr3 = await xattr.getAsync(target, FRUITMIX)

  return {
    uuid,
    type: 'file',
    name: path.basename(target),
    mtime: stats.mtime.getTime(),
    size: stats.size,
    magic: attr2.magic, 
    hash
  } 
}

const updateFileAsync = async (target, source, hash) => {

  let htime, { stats, attr } = await readXstatAsync(target, true)
  let attr2 = { uuid: attr.uuid }

  if (hash) {
    let stats2 = await fs.lstatAsync(source)
    attr2.hash = hash
    attr2.htime = stats2.mtime.getTime() 
  } 

  await xattr.setAsync(source, FRUITMIX, JSON.stringify(attr2))
  await fs.renameAsync(source, target)
  return await readXstatAsync(target, false)
}


// props may have uuid and/or hash
// if no uuid, a new uuid is generated
const forceFileXattrAsync = async (target, props) => {

  let magic = await fileMagicAsync(target)
  let uuid = props.uuid || UUID.v4()
  let attr = { uuid, magic } 

  if (props.hash) {
    let stats = await fs.statAsync(target)
    attr.hash = props.hash
    attr.htime = stats.mtime.getTime()
  }

  return await xattr.setAsync(target, FRUITMIX, JSON.stringify(attr))
}

// this function is used when init drive
const forceDriveXstatAsync = async (target, driveUUID) => {

  let attr = { uuid: driveUUID }
  await xattr.setAsync(target, FRUITMIX, JSON.stringify(attr))
  return await readXstatAsync(target, false)
}

const readXstat = (target, callback) => 
  readXstatAsync(target, false).asCallback(callback)

const peekXattr = (target, callback) => 
  peekXattrAsync(target).asCallback(callback)

const updateFileHash = (target, uuid, hash, htime, callback) =>
  updateFileHashAsync(target, uuid, hash, htime).asCallback(callback)

const updateFile = (target, source, hash, callback) => {
  if (typeof hash === 'function') {
    callback = hash
    hash = undefined
  }
  updateFileAsync(target, source, hash).asCallback(callback)
}

const forceDriveXstat = (target, driveUUID, callback) => 
  forceDriveXstatAsync(target, driveUUID).asCallback(callback) 

export { 

  readTimeStamp,
  readXstat,
  readXstatAsync,
  peekXattr,
  peekXattrAsync,
  updateFileHash,
  updateFileHashAsync,
  updateFile,
  updateFileAsync,
  forceDriveXstat,
  forceDriveXstatAsync,
  forceFileXattrAsync,

  // testing only
  parseMagic,
  fileMagic
}


