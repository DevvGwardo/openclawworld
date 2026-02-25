// Sound registry — maps logical sound keys to file paths and options
// All paths are relative to /audio/ in the public directory

export const SOUNDS = {
  // === Music ===
  ambient_room: { src: "/audio/music/ambient_room.ogg", loop: true, volume: 0.3, category: "music" },

  // === SFX ===
  footstep_1: { src: "/audio/sfx/footstep_1.ogg", volume: 0.25, category: "sfx" },
  footstep_2: { src: "/audio/sfx/footstep_2.ogg", volume: 0.25, category: "sfx" },
  footstep_3: { src: "/audio/sfx/footstep_3.ogg", volume: 0.25, category: "sfx" },
  sit_down: { src: "/audio/sfx/sit_down.ogg", volume: 0.4, category: "sfx" },
  dance_start: { src: "/audio/sfx/dance_start.ogg", volume: 0.4, category: "sfx" },
  wave_emote: { src: "/audio/sfx/wave_emote.ogg", volume: 0.35, category: "sfx" },
  chat_send: { src: "/audio/sfx/chat_send.ogg", volume: 0.3, category: "sfx" },
  chat_receive: { src: "/audio/sfx/chat_receive.ogg", volume: 0.25, category: "sfx" },
  dm_receive: { src: "/audio/sfx/dm_receive.ogg", volume: 0.35, category: "sfx" },
  player_join: { src: "/audio/sfx/player_join.ogg", volume: 0.2, category: "sfx" },
  player_leave: { src: "/audio/sfx/player_leave.ogg", volume: 0.15, category: "sfx" },
  room_transition: { src: "/audio/sfx/room_transition.ogg", volume: 0.4, category: "sfx" },
  item_place: { src: "/audio/sfx/item_place.ogg", volume: 0.4, category: "sfx" },
  item_pickup: { src: "/audio/sfx/item_pickup.ogg", volume: 0.35, category: "sfx" },
  quest_accept: { src: "/audio/sfx/quest_accept.ogg", volume: 0.5, category: "sfx" },
  quest_complete: { src: "/audio/sfx/quest_complete.ogg", volume: 0.5, category: "sfx" },
  purchase_complete: { src: "/audio/sfx/purchase_complete.ogg", volume: 0.45, category: "sfx" },
  build_mode_enter: { src: "/audio/sfx/build_mode_enter.ogg", volume: 0.35, category: "sfx" },
  build_mode_exit: { src: "/audio/sfx/build_mode_exit.ogg", volume: 0.3, category: "sfx" },

  // === UI ===
  button_click: { src: "/audio/ui/button_click.ogg", volume: 0.25, category: "ui" },
  menu_open: { src: "/audio/ui/menu_open.ogg", volume: 0.3, category: "ui" },
  menu_close: { src: "/audio/ui/menu_close.ogg", volume: 0.25, category: "ui" },
  tab_switch: { src: "/audio/ui/tab_switch.ogg", volume: 0.2, category: "ui" },
  notification: { src: "/audio/ui/notification.ogg", volume: 0.35, category: "ui" },
};
