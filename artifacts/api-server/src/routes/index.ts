import { Router } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import invitesRouter from "./invites";
import contentRouter from "./content";
import roomsRouter from "./rooms";
import proxyRouter from "./proxy";

const router = Router();

router.use("/", healthRouter);
router.use("/users", usersRouter);
router.use("/invites", invitesRouter);
router.use("/content", contentRouter);
router.use("/rooms", roomsRouter);
router.use("/proxy", proxyRouter);

export default router;
