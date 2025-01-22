const express = require("express");
const { v4: uuidv4 } = require("uuid");

module.exports = function (app, io) {
  // Generate a unique room for video appointments
  app.get("/appointment", (req, res) => {
    const roomId = uuidv4();
    res.redirect(`/appointment/${roomId}`);
  });

  // Serve the appointment room
  app.get("/appointment/:roomId", (req, res) => {
    res.sendFile(__dirname + "/public/index.html"); // Adjust the path as needed
  });

  // Real-time connection for video calls
  io.on("connection", (socket) => {
    console.log("A user connected");

    socket.on("join-room", (roomId, userId) => {
      socket.join(roomId);
      socket.to(roomId).emit("user-connected", userId);

      socket.on("disconnect", () => {
        socket.to(roomId).emit("user-disconnected", userId);
      });
    });
  });
};
