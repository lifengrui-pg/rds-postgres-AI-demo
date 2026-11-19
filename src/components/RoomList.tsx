import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Room } from '../types/database'
import CreateRoomModal from './CreateRoomModal'

interface Props {
  currentUserId: string
  selectedRoomId: number | null
  onSelect: (room: Room) => void
}

// 列表项：房间 + 单聊场景的动态显示名
interface RoomEntry {
  room: Room
  // 单聊显示"对方"的用户名；群聊为 null（直接用群名）
  directPeerName: string | null
}

export default function RoomList({ currentUserId, selectedRoomId, onSelect }: Props) {
  const [entries, setEntries] = useState<RoomEntry[]>([])
  const [showModal, setShowModal] = useState(false)

  const loadRooms = useCallback(async () => {
    // 查询自己所在的房间（RLS 自动过滤，只会返回自己是成员的房间），
    // 同时带出房间成员，用于计算单聊的显示名。
    // rooms.name 是创建时写入的"创建者视角的对方名字"，对另一方是错的，
    // 因此单聊名称动态取"房间里不是我的那个成员"
    const { data } = await supabase
      .from('room_members')
      .select('rooms(*, room_members(user_id, profiles(username)))')
      .eq('user_id', currentUserId)
      .order('joined_at', { ascending: false })

    if (data) {
      interface MemberRow {
        user_id: string
        profiles: { username: string } | null
      }
      interface Row {
        rooms: (Room & { room_members: MemberRow[] }) | null
      }

      const seen = new Set<number>()
      const list: RoomEntry[] = []
      for (const row of data as unknown as Row[]) {
        if (!row.rooms || seen.has(row.rooms.id)) continue
        seen.add(row.rooms.id)

        let directPeerName: string | null = null
        if (row.rooms.is_direct) {
          const peer = (row.rooms.room_members || []).find(
            (m) => m.user_id !== currentUserId,
          )
          // 成员记录可能尚未同步（刚建房的瞬间），降级用 rooms.name
          directPeerName = peer?.profiles?.username ?? row.rooms.name
        }
        list.push({ room: row.rooms, directPeerName })
      }
      setEntries(list)
    }
  }, [currentUserId])

  useEffect(() => {
    loadRooms()

    // 订阅 room_members 变更：创建群聊或被拉入新群时，列表实时刷新。
    // 非成员的房间变更会被 RLS 过滤，不会推送过来。
    const channel = supabase
      .channel('room-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members' },
        () => loadRooms(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadRooms])

  function handleCreated(roomId: number, room: Room) {
    setShowModal(false)
    loadRooms()
    onSelect(room)
    void roomId
  }

  return (
    <aside className="room-list">
      <div className="room-list-header">
        <span>会话</span>
        <button className="icon-btn" title="新建会话" onClick={() => setShowModal(true)}>
          +
        </button>
      </div>

      {entries.length === 0 && (
        <div className="room-list-empty">还没有会话，点击 + 创建</div>
      )}

      <ul>
        {entries.map(({ room, directPeerName }) => {
          const displayName = room.is_direct ? (directPeerName ?? room.name) : room.name
          return (
            <li
              key={room.id}
              className={`room-item ${room.id === selectedRoomId ? 'active' : ''}`}
              onClick={() => onSelect(room)}
            >
              <span className={`avatar ${room.is_direct ? 'avatar-direct' : 'avatar-group'}`}>
                {room.is_direct ? displayName[0].toUpperCase() : '#'}
              </span>
              <div className="room-item-info">
                <div className="room-item-name">{displayName}</div>
                <div className="room-item-type">{room.is_direct ? '单聊' : '群聊'}</div>
              </div>
            </li>
          )
        })}
      </ul>

      {showModal && (
        <CreateRoomModal
          currentUserId={currentUserId}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </aside>
  )
}
