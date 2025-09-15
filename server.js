const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' 
            ? ["https://chatpublico-privado.vercel.app"] // Cambiar por tu dominio de Vercel
            : "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Almacenar usuarios conectados
const connectedUsers = new Map();
const usernames = new Set();

// Manejar conexiones de socket
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    
    // Manejar unión de usuario
    socket.on('join', (username) => {
        // Verificar si el nombre de usuario ya está en uso
        if (usernames.has(username)) {
            socket.emit('usernameTaken');
            return;
        }
        
        // Agregar usuario
        const user = {
            id: socket.id,
            username: username,
            joinTime: new Date()
        };
        
        connectedUsers.set(socket.id, user);
        usernames.add(username);
        
        console.log(`${username} se unió al chat`);
        
        // Confirmar unión exitosa
        socket.emit('userJoined', {
            users: Array.from(connectedUsers.values())
        });
        
        // Notificar a todos los usuarios sobre la actualización de la lista
        io.emit('usersUpdate', Array.from(connectedUsers.values()));
        
        // Mensaje de bienvenida en el chat público
        io.emit('publicMessage', {
            sender: 'Sistema',
            message: `${username} se unió al chat`,
            timestamp: new Date(),
            type: 'system'
        });
    });
    
    // Manejar mensajes públicos
    socket.on('publicMessage', (message) => {
        const user = connectedUsers.get(socket.id);
        if (!user) return;
        
        const messageData = {
            sender: user.username,
            message: message,
            timestamp: new Date(),
            type: 'public'
        };
        
        console.log(`Mensaje público de ${user.username}: ${message}`);
        
        // Enviar a todos los usuarios
        io.emit('publicMessage', messageData);
    });
    
    // Manejar mensajes privados
    socket.on('privateMessage', (data) => {
        const sender = connectedUsers.get(socket.id);
        const recipient = connectedUsers.get(data.to);
        
        if (!sender || !recipient) {
            socket.emit('error', 'Usuario no encontrado');
            return;
        }
        
        const messageData = {
            sender: sender.username,
            to: recipient.username,
            message: data.message,
            timestamp: new Date(),
            type: 'private'
        };
        
        console.log(`Mensaje privado de ${sender.username} para ${recipient.username}: ${data.message}`);
        
        // Enviar el mensaje al destinatario y al remitente
        socket.to(data.to).emit('privateMessage', messageData);
        socket.emit('privateMessage', messageData);
    });
    
    // Manejar desconexión
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        
        if (user) {
            console.log(`${user.username} se desconectó`);
            
            // Remover usuario de las listas
            connectedUsers.delete(socket.id);
            usernames.delete(user.username);
            
            // Notificar a todos sobre la actualización de usuarios
            io.emit('usersUpdate', Array.from(connectedUsers.values()));
            
            // Mensaje de despedida en el chat público
            io.emit('publicMessage', {
                sender: 'Sistema',
                message: `${user.username} se desconectó del chat`,
                timestamp: new Date(),
                type: 'system'
            });
        }
        
        console.log('Usuario desconectado:', socket.id);
    });
    
    // Manejar errores
    socket.on('error', (error) => {
        console.error('Error de socket:', error);
    });
});

// Función para limpiar usuarios inactivos (opcional)
setInterval(() => {
    const now = new Date();
    const timeout = 5 * 60 * 1000; // 5 minutos
    
    connectedUsers.forEach((user, socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket || !socket.connected) {
            console.log(`Limpiando usuario inactivo: ${user.username}`);
            connectedUsers.delete(socketId);
            usernames.delete(user.username);
        }
    });
}, 60000); // Verificar cada minuto

// Ruta para obtener estadísticas (opcional)
app.get('/api/stats', (req, res) => {
    res.json({
        connectedUsers: connectedUsers.size,
        users: Array.from(connectedUsers.values()).map(user => ({
            username: user.username,
            joinTime: user.joinTime
        }))
    });
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
    console.log('Funcionalidades disponibles:');
    console.log('- Chat público en tiempo real');
    console.log('- Chat privado entre usuarios');
    console.log('- Lista de usuarios conectados');
    console.log('- Sistema de nombres únicos');
});

// Manejo de errores del servidor
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Puerto ${PORT} ya está en uso`);
        process.exit(1);
    } else {
        console.error('Error del servidor:', error);
    }
});

// Manejo de cierre del servidor
process.on('SIGTERM', () => {
    console.log('Cerrando servidor...');
    server.close(() => {
        console.log('Servidor cerrado correctamente');
        process.exit(0);
    });
});