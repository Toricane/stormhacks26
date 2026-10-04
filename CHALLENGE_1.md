> [!NOTE]
> This file contains the details of one of the two challenges that we will be focusing on. This is copy pasted directly from the provided document. We need to focus on either this one or `CHALLENGE_2.md`.

**Custom Challenge #1**  
**Beyond Euclid: Interactive Experiences in Impossible Geometries**

At the intersection of mathematics, computer graphics, and creative interaction design, the goal of this challenge is to build an interactive application that takes place in a world where the familiar rules of Euclidean geometry no longer apply. Participants are free to choose the type of application they want to build, a game, a visualization tool, an educational experience, a productivity application, a novel user interface, or anything else they can imagine. The only requirement is that non-Euclidean geometry must be a central, meaningful part of the experience. 

The best projects will not just display non-Euclidean geometry, they will make the user feel it, interact with it, and discover something new about space itself.

**What Are Non-Euclidean Geometries?**  
In everyday life, we intuitively understand space through Euclidean geometry: parallel lines never meet, the angles of a triangle add up to 180°, and the shortest path between two points is a straight line. But what happens when these rules break down?

**Non-Euclidean geometries offer entirely different spatial paradigms:**

* **Hyperbolic Geometry:** Space expands exponentially. Parallel lines diverge, triangles have angles summing to less than 180°, and infinite area can fit inside a finite circle (the Poincaré disk). Imagine a world where walking straight ahead causes you and your friend walking "parallel" to drift farther and farther apart.

* **Spherical/Elliptic Geometry**: Space curves back on itself. Parallel lines eventually converge, triangles have angles exceeding 180°, and there are no true parallel lines at all. 

* **4D Projections**: Just as a 3D object casts a 2D shadow, a four-dimensional object can be projected into our 3D world. The shadows behave in counterintuitive ways, objects can pass through each other without collision, and rotations happen in planes we cannot directly perceive.

* **Impossible Spaces & Escher-like Worlds**: Spaces where "up" and "down" loop continuously, corridors that fold into themselves, or environments where perspective breaks down and distant objects appear larger than nearby ones.


![M.C. Escher Wallpapers - Top Free M.C. Escher Backgrounds - WallpaperAccess][image1]

**Why Is This Challenging?**  
Rendering and interacting in non-Euclidean spaces is fundamentally harder than standard 3D graphics. Traditional rendering pipelines assume flat (Euclidean) space. To create these experiences, participants will need to rethink:

* **Coordinate Systems**: How do you represent positions, velocities, and transformations when the underlying metric is not flat?

* **Rendering**: Standard perspective projection may need to be replaced or augmented. Hyperbolic space, for example, requires mapping curved geodesics onto a flat screen. Techniques like stereographic projection, conformal maps, or ray-marching through curved metrics become essential.

* **Interaction & Navigation**: How does a user move, aim, or select objects when "straight ahead" means something different? Camera controls, collision detection, and physics all need redesign.




**What Can You Build?**  
Participants are completely free in their choice of application type. Here are some ideas to spark creativity:  
**Games**

* A puzzle game set in hyperbolic space where the player must navigate an exponentially expanding maze.  
* An Escher-inspired platformer where gravity shifts and corridors loop impossibly.  
* A strategy game where the map is a hyperbolic plane, giving players exponentially more territory the further they expand.  
  **Visualization & Educational Tools**  
* An interactive explorer of 4D polytopes (hypercube, 24-cell, 120-cell) that the user can rotate, slice, and project.  
* A tool that lets users "walk" through different geometries (Euclidean, hyperbolic, spherical) and observe how shapes, distances, and angles change.  
* A visualization of geodesics, curvature, and parallel transport in real-time.  
  **Productivity & Novel Interfaces**  
* A hyperbolic file browser or mind-map tool where the exponential space allows hierarchical data to be displayed without clutter.  
* A 4D-based data visualization tool for high-dimensional datasets.  
  **Art & Creative Experiences**  
* A generative art tool that creates patterns in non-Euclidean spaces.  
* A virtual gallery where the architecture itself defies Euclidean logic.

**Evaluation Criteria**  
Submissions will be evaluated based on the following criteria:

**Geometric Creativity (30%)**

* Originality and depth of the non-Euclidean concept.  
* How meaningfully the unusual geometry is integrated into the experience. (It should not be merely cosmetic)  
* Mathematical correctness and coherence of the geometric model.

**User Experience & Interaction (30%)**

* How intuitively and engagingly the user interacts with the non-Euclidean space.  
* Quality of navigation, camera controls, and feedback mechanisms.  
* The experience should feel purposeful, not disorienting for its own sake.

**Graphics & Technical Execution (25%)**

* Visual clarity, aesthetic quality, and polish.  
* Performance: the application should run smoothly (target 30+ FPS for real-time applications).  
* Code quality, architecture, and efficiency of the geometric computations.

**Documentation & Presentation (15%)**

* Clear explanation of the mathematical and technical approach.  
* Well-documented code with comments.  
* A compelling demo/presentation that showcases the experience.  
* Bonus Points  
* Beyond Gaming: Innovative applications in education, productivity, data visualization, or art.  
* Educational Value: Projects that help users understand non-Euclidean geometry through interaction.  
* Exceptional Polish: Outstanding visual design, sound design, or gameplay depth.  
* Novel Technical Approach: New or particularly elegant formulations for rendering or interacting in curved spaces.

**Resources**

**Mathematics & Geometry**  
[Non-Euclidean geometry - Wikipedia](https://en.wikipedia.org/wiki/Non-Euclidean_geometry)  
[MIT introduction to Non-Euclidean spaces](https://ocw.mit.edu/courses/8-286-the-early-universe-fall-2013/resources/lecture-10-introduction-to-non-euclidean-spaces/)

**Graphics & Rendering**  
[Portals to Non-Euclidean Geometries](https://www.youtube.com/watch?v=yqUv2JO2BCs)  
[Non-Euclidean Worlds Engine](https://www.youtube.com/watch?v=kEB11PQ9Eo8)  
[Non-Euclidean Geometry Explained - Hyperbolica Devlog #1](https://www.youtube.com/watch?v=zQo_S3yNa2w)  
[Spherical Geometry Is Stranger Than Hyperbolic - Hyperbolica Devlog #2](https://www.youtube.com/watch?v=yY9GAyJtuJ0)

**Inspiration**  
[https://mcescher.com/](https://mcescher.com/)  
[Margaret Wertheim: The beautiful math of coral (and crochet)](http://ideas.txthttps://www.youtube.com/watch?v=zGEDHMF4rLI&t=706s)  
[Benoit Mandelbrot: Fractals and the art of roughness](https://www.youtube.com/watch?v=ay8OMOsf6AQ)

