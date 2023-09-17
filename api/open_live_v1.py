# -*- coding: utf-8 -*-
import asyncio
import enum
import json
import logging
import random
import time
import uuid
import hashlib
import hmac
import cachetools
from hashlib import sha256
from typing import *

import aiohttp
import tornado.websocket

import api.base
import blivedm.blivedm.clients.web as dm_web_cli
import config
import services.avatar
import services.chat
import services.translate
import utils.request

from .open_live import _read_response, BusinessError, TransportError

logger = logging.getLogger(__name__)


WS_INFO_OPEN_LIVE_URL = 'https://live-open.biliapi.com/v1/common/websocketInfo'


async def _request_open_live_v1(url, body: dict) -> dict:
    cfg = config.get_config()
    
    params = json.dumps(body)
    key = cfg.open_live_v1_access_key_id
    secret = cfg.open_live_v1_access_key_secret.encode()

    md5 = hashlib.md5()
    md5.update(params.encode())
    ts = time.time()
    nonce = random.randint(1, 100000)+time.time()
    md5data = md5.hexdigest()

    header_map = {
        "x-bili-timestamp": str(int(ts)),
        "x-bili-signature-method": "HMAC-SHA256",
        "x-bili-signature-nonce": str(nonce),
        "x-bili-accesskeyid": key,
        "x-bili-signature-version": "1.0",
        "x-bili-content-md5": md5data,
    }

    header_list = sorted(header_map)
    header_str = ''

    for key in header_list:
        header_str = header_str + key+":"+str(header_map[key])+"\n"
    header_str = header_str.rstrip("\n")

    data = header_str.encode()
    signature = hmac.new(secret, data, digestmod=sha256).hexdigest()
    header_map["Authorization"] = signature
    header_map["Content-Type"] = "application/json"
    header_map["Accept"] = "application/json"
    
    try:
        req_ctx_mgr = utils.request.http_session.post(url, headers=header_map, data=params)
        return await _read_response(req_ctx_mgr)
    except TransportError:
        logger.exception('Request open live failed:')
        raise
    except BusinessError as e:
        logger.warning('Request open live failed: %s', e)
        raise
    
    
class RoomInfoHandler(api.base.ApiHandler):
    async def get(self):
        room_id = int(self.get_query_argument('roomId'))
        logger.info('client=%s getting room info, room=%d', self.request.remote_ip, room_id)
        res = await _request_open_live_v1(WS_INFO_OPEN_LIVE_URL, {'room_id': room_id})
        self.write(res)

    @staticmethod
    async def _get_room_info(room_id):
        try:
            async with utils.request.http_session.get(
                dm_web_cli.ROOM_INIT_URL,
                headers={
                    **utils.request.BILIBILI_COMMON_HEADERS,
                    'Origin': 'https://live.bilibili.com',
                    'Referer': f'https://live.bilibili.com/{room_id}'
                },
                params={
                    'room_id': room_id
                }
            ) as res:
                if res.status != 200:
                    logger.warning('room=%d _get_room_info failed: %d %s', room_id,
                                   res.status, res.reason)
                    return room_id, 0
                data = await res.json()
        except (aiohttp.ClientConnectionError, asyncio.TimeoutError):
            logger.exception('room=%d _get_room_info failed', room_id)
            return room_id, 0

        if data['code'] != 0:
            logger.warning('room=%d _get_room_info failed: %s', room_id, data['message'])
            return room_id, 0

        room_info = data['data']['room_info']
        return room_info['room_id'], room_info['uid']
    

ROUTES = [
    (r'/api/open_live/v1/room_info', RoomInfoHandler),
]
