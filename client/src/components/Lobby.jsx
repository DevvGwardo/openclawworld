import {
  AccumulativeShadows,
  Html,
  RandomizedLight,
  Text3D,
  useFont,
} from "@react-three/drei";
import { motion } from "framer-motion-3d";
import { useAtom } from "jotai";
import { Suspense, useMemo, useRef } from "react";
import { LobbyAvatar } from "./LobbyAvatar";
import { TownHall } from "./TownHall";
import { Apartment } from "./Apartment";
import { ShopBuilding } from "./ShopBuilding";
import { SmallBuilding } from "./SmallBuilding";
import { Skyscraper } from "./Skyscraper";
import { avatarUrlAtom, mapAtom, roomIDAtom, roomsAtom, socket } from "./SocketManager";
import { Tablet } from "./Tablet";
let firstLoad = true;
export const Lobby = () => {
  const [rooms] = useAtom(roomsAtom);
  const [avatarUrl] = useAtom(avatarUrlAtom);
  const [_roomID, setRoomID] = useAtom(roomIDAtom);
  const [_map, setMap] = useAtom(mapAtom);
  const joinRoom = (roomId) => {
    socket.emit("joinRoom", roomId, {
      avatarUrl,
    });
    setMap(null);
    setRoomID(roomId);
  };

  const isMobile = window.innerWidth < 1024;

  const tablet = useRef();

  const goldenRatio = Math.min(1, window.innerWidth / 1600);

  const accumulativeShadows = useMemo(
    () => (
      <AccumulativeShadows
        temporal
        frames={30}
        alphaTest={0.85}
        scale={80}
        position={[0, 0.01, 0]}
        color="pink"
      >
        <RandomizedLight
          amount={4}
          radius={9}
          intensity={0.55}
          ambient={0.25}
          position={[5, 5, -20]}
        />
        <RandomizedLight
          amount={4}
          radius={5}
          intensity={0.25}
          ambient={0.55}
          position={[-5, 5, -20]}
        />
      </AccumulativeShadows>
    ),
    []
  );
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent); // ugly safari fix as transform position is buggy on it

  return (
    <group position-y={-1.5}>
      {/* === CITY GROUND PLANE === */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#8a8a8a" />
      </mesh>
      {/* Sidewalk / plaza area around town hall */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.0} position-z={-6}>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#b0b0b0" />
      </mesh>

      {/* === TABLET UI (room selector) === */}
      <motion.group
        ref={tablet}
        scale={isMobile ? 0.18 : 0.22}
        position-x={isMobile ? 0 : -0.25 * goldenRatio}
        position-z={0.5}
        initial={{
          y: firstLoad ? 0.5 : 1.5,
          rotateY: isSafari ? 0 : isMobile ? 0 : Math.PI / 8,
        }}
        animate={{
          y: isMobile ? 1.65 : 1.5,
        }}
        transition={{
          duration: 1,
          delay: 0.5,
        }}
        onAnimationComplete={() => {
          firstLoad = false;
        }}
      >
        <Tablet scale={0.03} rotation-x={Math.PI / 2} />
        <Html
          position={[0, 0.17, 0.11]}
          transform={!isSafari}
          center
          scale={0.121}
        >
          <div
            className={`${
              isSafari
                ? "w-[310px] h-[416px] lg:w-[390px] lg:h-[514px]"
                : "w-[390px] h-[514px]"
            }  max-w-full  overflow-y-auto p-5  place-items-center pointer-events-none select-none`}
          >
            <div className="w-full overflow-y-auto flex flex-col space-y-2">
              <h1 className="text-center text-white text-2xl font-bold">
                WELCOME TO
                <br />
                MOLT'S LAND
              </h1>
              <p className="text-center text-white">
                Please select a room to relax
              </p>
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="p-4 rounded-lg bg-slate-800 bg-opacity-70 text-white hover:bg-slate-950 transition-colors cursor-pointer pointer-events-auto"
                  onClick={() => joinRoom(room.id)}
                >
                  <p className="text-uppercase font-bold text-lg">
                    {room.name}
                  </p>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-4 h-4 rounded-full ${
                        room.nbCharacters > 0 ? "bg-green-500" : "bg-orange-500"
                      }`}
                    ></div>
                    {room.nbCharacters} people in this room
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Html>
      </motion.group>

      {/* === CITY BUILDINGS LAYOUT === */}
      <group position-z={-8}>
        {/* MOLT'S LAND 3D text */}
        <group rotation-y={Math.PI / 6}>
          <Text3D
            font={"fonts/Inter_Bold.json"}
            position-z={1}
            size={0.3}
            position-x={-3}
            castShadow
            rotation-y={Math.PI / 8}
            bevelEnabled
            bevelThickness={0.005}
            letterSpacing={0.012}
          >
            LAND
            <meshStandardMaterial color="white" />
          </Text3D>

          <Text3D
            font={"fonts/Inter_Bold.json"}
            position-z={2.5}
            size={0.3}
            position-x={-3}
            castShadow
            rotation-y={Math.PI / 8}
            bevelEnabled
            bevelThickness={0.005}
            letterSpacing={0.012}
          >
            MOLT'S
            <meshStandardMaterial color="white" />
          </Text3D>
        </group>

        {/* Town Hall - center back, the main building */}
        <TownHall scale={3.0} position={[0, 0, -2]} />

        {/* Apartment building - left side */}
        <group position={[-5, 0, -1]}>
          <Apartment scale={4.3} />
          <Html position={[0, 3.5, 0]} center distanceFactor={15} zIndexRange={[1, 0]} style={{ pointerEvents: "none" }}>
            <div className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded-md shadow-md border border-amber-200 whitespace-nowrap">
              <p className="text-xs font-bold text-amber-700 text-center">APARTMENTS</p>
            </div>
          </Html>
        </group>

        {/* Shop building - right side */}
        <ShopBuilding scale={4.4} position={[4.5, 0, 0]} rotation-y={-Math.PI / 2} />

        {/* Small buildings - flanking */}
        <SmallBuilding scale={4.1} position={[-3, 0, 2]} rotation-y={Math.PI / 4} />
        <SmallBuilding scale={4.0} position={[3, 0, 2.5]} rotation-y={-Math.PI / 6} />

        {/* Skyscrapers in the background for depth */}
        <Skyscraper scale={4.42} position={[0, 0, -6]} />
        <Skyscraper scale={4.1} position={[-7, 0, -5]} />
        <Skyscraper scale={3.9} position={[7, 0, -4]} />
      </group>

      {accumulativeShadows}
      <Suspense>
        <LobbyAvatar
          position-z={-1}
          position-x={0.5 * goldenRatio}
          position-y={isMobile ? -0.4 : 0}
          rotation-y={-Math.PI / 8}
        />
      </Suspense>
    </group>
  );
};

useFont.preload("/fonts/Inter_Bold.json");
