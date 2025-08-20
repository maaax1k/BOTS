import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button
} from "@mui/material";

function DeleteMessageButton({ onDelete }) {
  const [open, setOpen] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleConfirm = () => {
    onDelete();   // здесь вызывается твоя логика удаления сообщения
    setOpen(false);
  };

  return (
    <>
      <Button variant="outlined" color="error" onClick={handleClickOpen}>
        Удалить сообщение
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
      >
        <DialogTitle>Удалить сообщение?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Это действие нельзя отменить. Ты уверен, что хочешь удалить сообщение?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Отмена</Button>
          <Button onClick={handleConfirm} color="error" autoFocus>
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default DeleteMessageButton;