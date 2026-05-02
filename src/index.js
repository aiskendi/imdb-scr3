import { Hono } from "hono";
import { cors } from "hono/cors";
import index from "./routes/index.js";
import search from "./routes/search.js";
import title from "./routes/title.js";
import reviews from "./routes/reviews.js";
import userRoutes from "./routes/user/index.js";
import cache from "./helpers/cache";

const app = new Hono();

app.use("*", cors());
app.use("*", cache);

app.route("/search", search);
app.route("/title", title);
app.route("/reviews", reviews);
app.route("/user", userRoutes);
app.route("/", index);

export default app;
