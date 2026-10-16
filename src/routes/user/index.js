import { Hono } from "hono";
import userInfo from "./info.js";
import userRating from "./rating.js";
const userRoutes = new Hono();

userRoutes.get("/:id", userInfo);
userRoutes.get("/:id/ratings", userRating);

export default userRoutes;
