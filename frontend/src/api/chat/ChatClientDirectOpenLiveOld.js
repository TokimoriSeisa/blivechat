import axios from 'axios'

import * as chat from '.'
import * as base from './ChatClientOfficialBase'
import ChatClientOfficialBase from './ChatClientOfficialBase'

export default class ChatClientDirectOpenLiveOld extends ChatClientOfficialBase {
  constructor(roomId) {
    super()
    this.CMD_CALLBACK_MAP = CMD_CALLBACK_MAP

    // 调用initRoom后初始化，如果失败，使用这里的默认值
    this.roomId = roomId
    this.roomOwnerUid = -1
    this.hostServerList = [
      { host: "broadcastlv.chat.bilibili.com", port: 2243, wss_port: 443, ws_port: 2244 }
    ]
  }

  async initRoom() {
    let res
    try {
      res = (await axios.get('/api/room_info', { params: {
        roomId: this.roomId
      } })).data
    } catch {
      return true
    }
    this.roomId = res.roomId
    this.roomOwnerUid = res.ownerUid
    if (res.hostServerList.length !== 0) {
      this.hostServerList = res.hostServerList
    }

    try {
      res = (await axios.get('/api/open_live/v1/room_info', { params: {
        roomId: this.roomId
      } })).data
    } catch {
      let data = {
        authorName: 'SYSTEM',
        content: 'ERROR: request `get_open_live_room_info` failed.',
      }
      this.onAddText(data)
    }

    this.authBody = res.data.auth_body
    this.hostServerList = res.data.host.map(host => {
      return { host: host, port: res.data.tcp_port[0], wss_port: res.data.wss_port[0], ws_port: res.data.ws_port[0] }
    })

    return true
  }

  async onBeforeWsConnect() {
    // 重连次数太多则重新init_room，保险
    let reinitPeriod = Math.max(3, (this.hostServerList || []).length)
    if (this.retryCount > 0 && this.retryCount % reinitPeriod === 0) {
      this.needInitRoom = true
    }
    return super.onBeforeWsConnect()
  }

  getWsUrl() {
    let hostServer = this.hostServerList[this.retryCount % this.hostServerList.length]
    return `wss://${hostServer.host}:${hostServer.wss_port}/sub`
  }

  sendAuth() {
    this.websocket.send(this.makePacket(this.authBody, base.OP_AUTH))
  }

  async dmCallback(command) {
    if (!this.onAddText) {
      return
    }
    let data = command.data

    let authorType
    if (data.uid === this.roomOwnerUid) {
      authorType = 3
    } else if (data.guard_level !== 0) {
      authorType = 1
    } else {
      authorType = 0
    }

    let emoticon = null
    if (data.dm_type === 1) {
      emoticon = data.emoji_img_url
    }

    data = {
      avatarUrl: chat.processAvatarUrl(data.uface),
      timestamp: data.timestamp,
      authorName: data.uname,
      authorType: authorType,
      content: data.msg,
      privilegeType: data.guard_level,
      isGiftDanmaku: false,
      authorLevel: 1,
      isNewbie: false,
      isMobileVerified: true,
      medalLevel: data.fans_medal_wearing_status ? data.fans_medal_level : 0,
      id: data.msg_id,
      translation: '',
      emoticon: emoticon,
    }
    this.onAddText(data)
  }

  sendGiftCallback(command) {
    if (!this.onAddGift) {
      return
    }
    let data = command.data
    if (!data.paid) { // 丢人
      return
    }

    data = {
      id: data.msg_id,
      avatarUrl: chat.processAvatarUrl(data.uface),
      timestamp: data.timestamp,
      authorName: data.uname,
      totalCoin: data.price,
      giftName: data.gift_name,
      num: data.gift_num
    }
    this.onAddGift(data)
  }

  async guardCallback(command) {
    if (!this.onAddMember) {
      return
    }

    let data = command.data
    data = {
      id: data.msg_id,
      avatarUrl: chat.processAvatarUrl(data.user_info.uface),
      timestamp: data.timestamp,
      authorName: data.user_info.uname,
      privilegeType: data.guard_level
    }
    this.onAddMember(data)
  }

  superChatCallback(command) {
    if (!this.onAddSuperChat) {
      return
    }

    let data = command.data
    data = {
      id: data.message_id.toString(),
      avatarUrl: chat.processAvatarUrl(data.uface),
      timestamp: data.start_time,
      authorName: data.uname,
      price: data.rmb,
      content: data.message,
      translation: ''
    }
    this.onAddSuperChat(data)
  }

  superChatDelCallback(command) {
    if (!this.onDelSuperChat) {
      return
    }

    let ids = []
    for (let id of command.data.message_ids) {
      ids.push(id.toString())
    }
    this.onDelSuperChat({ ids })
  }
}

const CMD_CALLBACK_MAP = {
  LIVE_OPEN_PLATFORM_DM: ChatClientDirectOpenLiveOld.prototype.dmCallback,
  LIVE_OPEN_PLATFORM_SEND_GIFT: ChatClientDirectOpenLiveOld.prototype.sendGiftCallback,
  LIVE_OPEN_PLATFORM_GUARD: ChatClientDirectOpenLiveOld.prototype.guardCallback,
  LIVE_OPEN_PLATFORM_SUPER_CHAT: ChatClientDirectOpenLiveOld.prototype.superChatCallback,
  LIVE_OPEN_PLATFORM_SUPER_CHAT_DEL: ChatClientDirectOpenLiveOld.prototype.superChatDelCallback
}
