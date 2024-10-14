import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Piano, MidiNumbers } from 'react-piano';
import 'react-piano/dist/styles.css';
import { Noise } from 'noisejs';
import './App.css';
import './PianoStyles.css';

const NOTES = [
  'EP_A#2', 'EP_A#3', 'EP_A2', 'EP_A3', 'EP_B2', 'EP_B3', 'EP_C#2', 'EP_C#3',
  'EP_C2', 'EP_C3', 'EP_D#2', 'EP_D#3', 'EP_D2', 'EP_D3', 'EP_E2', 'EP_E3',
  'EP_F#2', 'EP_F#3', 'EP_F2', 'EP_F3', 'EP_G#2', 'EP_G#3', 'EP_G2', 'EP_G3'
];

// Adjustable parameters
const INITIAL_RADIUS = 150;  // Initial size of particles
const MIN_RADIUS = 15;  // Size at which particles are removed
const RADIUS_DECREASE_FACTOR = 0.9;  // How much smaller particles get on collision (e.g., 0.98 = 2% smaller)
const INITIAL_VELOCITY = 10;  // Initial velocity of particles
const VELOCITY_INCREASE_FACTOR = 1.02;  // How much faster particles get on collision
const MAX_VOLUME = 0.3; // Adjust this value to control the overall volume (0 to 1)
const MAX_POLYPHONY = 16; // Maximum number of simultaneous sounds

// Turbulence parameters
const TURBULENCE_STRENGTH = 0.2;
const TURBULENCE_FREQUENCY = 0.05;

const noise = new Noise(Math.random());

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

// Function to convert our note format to MidiNumbers format
const convertToMidiNote = (note) => {
  const [, noteName, octave] = note.match(/EP_([A-G]#?)(\d)/);
  return `${noteName}${octave}`;
};

// Sort notes and get first and last
const sortedNotes = [...NOTES].sort((a, b) => {
  const noteA = convertToMidiNote(a);
  const noteB = convertToMidiNote(b);
  return MidiNumbers.fromNote(noteA) - MidiNumbers.fromNote(noteB);
});

const firstNote = MidiNumbers.fromNote(convertToMidiNote(sortedNotes[0]));
const lastNote = MidiNumbers.fromNote(convertToMidiNote(sortedNotes[sortedNotes.length - 1]));



const flatToSharp = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#'
};

function App() {
  const [particles, setParticles] = useState([]);
  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBuffersRef = useRef({});
  const activeSourcesRef = useRef({});
  const [audioInitialized, setAudioInitialized] = useState(false);
  const animationFrameIdRef = useRef(null);
  const particlesRef = useRef(particles);
  const reverbNodeRef = useRef(null);

  useEffect(() => {
    particlesRef.current = particles;
  }, [particles]);

  const createImpulseResponse = useCallback((duration, decay, reverse = false) => {
    const sampleRate = audioContextRef.current.sampleRate;
    const length = sampleRate * duration;
    const impulse = audioContextRef.current.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
      right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }

    return impulse;
  }, []);

  const initializeAudio = useCallback(async () => {
    if (!audioInitialized) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create and connect the reverb node
      reverbNodeRef.current = audioContextRef.current.createConvolver();
      const impulseResponse = createImpulseResponse(1, 2); // 2 seconds duration, decay factor of 2
      reverbNodeRef.current.buffer = impulseResponse;
      reverbNodeRef.current.connect(audioContextRef.current.destination);

      // Load audio samples
      for (const note of NOTES) {
        try {
          const encodedNote = encodeURIComponent(note);
          const response = await fetch(`/samples/ElectricPiano/${encodedNote}.wav`);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
          audioBuffersRef.current[note] = audioBuffer;
        } catch (error) {
          console.error('Error loading audio:', error, note);
        }
      }
      setAudioInitialized(true);
    }
  }, [audioInitialized, createImpulseResponse]);

  const playNote = useCallback((note, x, radius) => {
    if (audioInitialized && audioBuffersRef.current[note]) {
      // Stop the previous playback of this note if it exists
      if (activeSourcesRef.current[note]) {
        activeSourcesRef.current[note].stop();
      }

      // Limit the number of simultaneous sounds
      const activeSources = Object.values(activeSourcesRef.current);
      if (activeSources.length >= MAX_POLYPHONY) {
        const oldestSource = activeSources[0];
        oldestSource.stop();
        delete activeSourcesRef.current[Object.keys(activeSourcesRef.current)[0]];
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffersRef.current[note];

      // Create a stereo panner node
      const panner = audioContextRef.current.createStereoPanner();
      
      // Calculate pan value based on x position (-1 to 1)
      const panValue = (x / canvasRef.current.width) * 2 - 1;
      panner.pan.setValueAtTime(panValue, audioContextRef.current.currentTime);

      // Create a gain node for volume control
      const gainNode = audioContextRef.current.createGain();
      
      // Calculate volume based on particle size (0.1 to 1)
      const volumeValue = Math.max(0.1, Math.min(1, radius / INITIAL_RADIUS));
      gainNode.gain.setValueAtTime(volumeValue * MAX_VOLUME, audioContextRef.current.currentTime);

      // Connect the nodes
      source.connect(panner);
      panner.connect(gainNode);
      gainNode.connect(reverbNodeRef.current);

      source.start();
      activeSourcesRef.current[note] = source;

      source.onended = () => {
        delete activeSourcesRef.current[note];
      };
    }
  }, [audioInitialized]);

  const updateParticle = useCallback((particle, canvas, particles, time) => {
    let { x, y, vx, vy, radius, note } = particle;
    const nextX = x + vx;
    const nextY = y + vy;

    // Apply turbulence
    const turbulenceX = noise.perlin3(x * TURBULENCE_FREQUENCY, y * TURBULENCE_FREQUENCY, time * 0.1) * TURBULENCE_STRENGTH;
    const turbulenceY = noise.perlin3(x * TURBULENCE_FREQUENCY + 100, y * TURBULENCE_FREQUENCY + 100, time * 0.1) * TURBULENCE_STRENGTH;
    
    vx += turbulenceX;
    vy += turbulenceY;

    let collided = false;
    let collisionX = x;

    // Check for wall collisions
    if (nextX - radius <= 0 || nextX + radius >= canvas.width) {
      vx *= -1;
      collided = true;
      collisionX = nextX - radius <= 0 ? radius : canvas.width - radius;
    }
    if (nextY - radius <= 0 || nextY + radius >= canvas.height) {
      vy *= -1;
      collided = true;
      collisionX = x;
    }

    // Check for collisions with other particles
    particles.forEach(otherParticle => {
      if (particle !== otherParticle) {
        const dx = otherParticle.x - nextX;
        const dy = otherParticle.y - nextY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = radius + otherParticle.radius;

        if (distance < minDistance) {
          // Collision detected
          collided = true;
          collisionX = nextX;

          // Calculate collision normal
          const nx = dx / distance;
          const ny = dy / distance;

          // Calculate relative velocity
          const relativeVelocityX = vx - otherParticle.vx;
          const relativeVelocityY = vy - otherParticle.vy;

          // Calculate impulse
          const impulse = 2 * (relativeVelocityX * nx + relativeVelocityY * ny) / (1 / radius + 1 / otherParticle.radius);

          // Apply impulse to both particles
          vx -= impulse * nx / radius;
          vy -= impulse * ny / radius;

          // Move particles apart to prevent sticking
          const overlap = minDistance - distance;
          x -= overlap * nx * 0.5;
          y -= overlap * ny * 0.5;
        }
      }
    });

    if (collided) {
      playNote(note, collisionX, radius);
      radius *= RADIUS_DECREASE_FACTOR;
      const speed = Math.sqrt(vx * vx + vy * vy);
      const newSpeed = speed * VELOCITY_INCREASE_FACTOR;
      vx = (vx / speed) * newSpeed;
      vy = (vy / speed) * newSpeed;
    } else {
      x = nextX;
      y = nextY;
    }

    return { ...particle, x, y, vx, vy, radius };
  }, [playNote]);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const time = Date.now() * 0.001; // Current time in seconds
    
    const updatedParticles = particlesRef.current
      .filter(particle => particle.radius > MIN_RADIUS)
      .map(particle => updateParticle(particle, canvas, particlesRef.current, time));

    setParticles(updatedParticles);

    updatedParticles.forEach(particle => {
      const hue = NOTES.indexOf(particle.note) * 15;
      
      // Create glow effect
      const gradient = ctx.createRadialGradient(
        particle.x, particle.y, 0,
        particle.x, particle.y, particle.radius * 1.5
      );
      gradient.addColorStop(0, `hsla(${hue}, 100%, 50%, 0.4)`);
      gradient.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
      
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw the main particle
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.8)`;
      ctx.fill();

      // Add a bright edge
      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, 0.8)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    animationFrameIdRef.current = requestAnimationFrame(animate);
  }, [updateParticle]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameIdRef.current);
    };
  }, [animate]);

  const getRandomPosition = useCallback((canvas, existingParticles, radius) => {
    const margin = canvas.width * 0.2; // 20% margin from edges
    const minDistance = INITIAL_RADIUS * 2; // Minimum distance from other particles

    for (let attempts = 0; attempts < 100; attempts++) {
      const x = margin + Math.random() * (canvas.width - 2 * margin);
      const y = margin + Math.random() * (canvas.height - 2 * margin);

      const isFarEnough = existingParticles.every(particle => {
        const dx = particle.x - x;
        const dy = particle.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance > minDistance;
      });

      if (isFarEnough) {
        return { x, y };
      }
    }

    // If we can't find a suitable position after 100 attempts, return the center
    return { x: canvas.width / 2, y: canvas.height / 2 };
  }, []);

  const addParticle = useCallback(async (note) => {
    console.log('addParticle called with note:', note);
    await initializeAudio();
    const canvas = canvasRef.current;
    const randomSize = INITIAL_RADIUS * (0.7 + Math.random() * 0.3);
    const { x, y } = getRandomPosition(canvas, particlesRef.current, randomSize);
    const newParticle = {
      x,
      y,
      vx: (Math.random() - 0.5) * INITIAL_VELOCITY,
      vy: (Math.random() - 0.5) * INITIAL_VELOCITY,
      radius: randomSize,
      note: note,
    };
    console.log('Adding new particle:', newParticle);
    setParticles(prevParticles => {
      console.log('Previous particles:', prevParticles);
      return [...prevParticles, newParticle];
    });
  }, [initializeAudio, getRandomPosition]);

  const addParticleForNote = useCallback((midiNumber) => {
    console.log('addParticleForNote called with midiNumber:', midiNumber);
    console.log('NOTES array:', NOTES);
    console.log('MidiNumber attributes:', MidiNumbers.getAttributes(midiNumber));
    
    const { note, octave } = MidiNumbers.getAttributes(midiNumber);
    
    // Convert flat to sharp if necessary
    const noteName = flatToSharp[note.slice(0, -1)] || note.slice(0, -1);
    const constructedNote = `EP_${noteName}${octave}`;
    
    console.log('Constructed note:', constructedNote);
    if (NOTES.includes(constructedNote)) {
      console.log('Note found in NOTES array, calling addParticle');
      addParticle(constructedNote);
    } else {
      console.log('Note not found in NOTES array');
    }
  }, [addParticle]);

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <div className="App">
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1,
          }}
        >
          <Piano
            noteRange={{ first: firstNote, last: lastNote }}
            playNote={(midiNumber) => {
              console.log('Piano playNote called with midiNumber:', midiNumber);
              addParticleForNote(midiNumber);
            }}
            stopNote={() => {}}
            width={600}
            renderNoteLabel={() => {}}
          />
        </div>
        <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
      </div>
    </ThemeProvider>
  );
}

export default App;