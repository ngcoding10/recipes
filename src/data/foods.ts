/**
 * Everyday foods people keep in a fridge or cupboard, for the pantry box: suggestions while
 * typing and spelling corrections ("brocoli" → "broccoli"). Roughly most common first.
 */
export const FOODS: string[] = `
chicken, chicken breast, chicken thighs, ground beef, beef, steak, pork, pork chops, bacon, ham, sausage, turkey, ground turkey, lamb,
salmon, tuna, shrimp, cod, tilapia, sardines, anchovies, crab, scallops, mussels,
eggs, egg whites, milk, butter, cheese, cheddar cheese, mozzarella, parmesan, feta, cream cheese, cottage cheese, ricotta, goat cheese, swiss cheese, provolone, halloumi, paneer,
yogurt, greek yogurt, sour cream, heavy cream, half and half, buttermilk, almond milk, oat milk, coconut milk, condensed milk, evaporated milk,
rice, brown rice, basmati rice, jasmine rice, pasta, spaghetti, penne, macaroni, lasagna, noodles, ramen, rice noodles, egg noodles, orzo, couscous, quinoa, oats, barley, bulgur, farro, polenta, cornmeal, grits,
bread, sourdough, tortillas, pita, naan, bagels, english muffins, buns, breadcrumbs, panko, crackers, croutons,
flour, whole wheat flour, almond flour, cornstarch, baking powder, baking soda, yeast, sugar, brown sugar, powdered sugar, honey, maple syrup, molasses, agave, vanilla extract, cocoa powder, chocolate, chocolate chips, dark chocolate,
potatoes, sweet potatoes, onion, red onion, green onions, scallions, shallots, leeks, garlic, ginger, carrots, celery, tomatoes, cherry tomatoes, bell pepper, red pepper, jalapeno, chili peppers,
broccoli, cauliflower, spinach, kale, lettuce, romaine, arugula, cabbage, red cabbage, brussels sprouts, bok choy, swiss chard, collard greens,
zucchini, squash, butternut squash, pumpkin, eggplant, cucumber, mushrooms, corn, peas, green beans, asparagus, artichokes, beets, radishes, turnips, parsnips, fennel, okra, bean sprouts, edamame, snow peas,
avocado, bananas, apples, oranges, lemon, lime, grapes, strawberries, blueberries, raspberries, blackberries, cranberries, cherries, peaches, pears, plums, mango, pineapple, watermelon, cantaloupe, kiwi, pomegranate, grapefruit, apricots, figs, dates, raisins, coconut,
beans, black beans, kidney beans, pinto beans, white beans, cannellini beans, chickpeas, lentils, red lentils, refried beans, tofu, tempeh, seitan, hummus,
almonds, walnuts, pecans, cashews, peanuts, pistachios, hazelnuts, pine nuts, macadamia nuts, peanut butter, almond butter, tahini, chia seeds, flax seeds, sesame seeds, sunflower seeds, pumpkin seeds,
olive oil, vegetable oil, canola oil, avocado oil, coconut oil, sesame oil, cooking spray, vinegar, balsamic vinegar, apple cider vinegar, rice vinegar, red wine vinegar, white wine vinegar,
soy sauce, tamari, fish sauce, oyster sauce, hoisin sauce, teriyaki sauce, worcestershire sauce, hot sauce, sriracha, ketchup, mustard, dijon mustard, mayonnaise, barbecue sauce, salsa, pesto, marinara sauce, tomato sauce, tomato paste, crushed tomatoes, diced tomatoes, chili crisp, gochujang, miso, harissa, curry paste,
chicken broth, beef broth, vegetable broth, stock, bouillon,
salt, pepper, black pepper, paprika, smoked paprika, cumin, coriander, turmeric, cinnamon, nutmeg, cloves, cardamom, allspice, chili powder, cayenne, red pepper flakes, curry powder, garam masala, oregano, basil, thyme, rosemary, sage, parsley, cilantro, dill, mint, chives, tarragon, bay leaves, garlic powder, onion powder, italian seasoning, taco seasoning, everything bagel seasoning, saffron, vanilla,
olives, capers, pickles, sauerkraut, kimchi, sun dried tomatoes, roasted red peppers, artichoke hearts, jam, jelly, nutella, applesauce,
protein powder, whey protein, granola, cereal, tortilla chips, popcorn, pretzels, rice cakes, gelatin, coffee, tea, matcha, orange juice, lemon juice, lime juice, wine, beer,
pizza dough, puff pastry, pie crust, phyllo dough, wonton wrappers, dumplings, gnocchi, hash browns, french fries, frozen vegetables, frozen berries, ice cream
`.split(',').map((s) => s.trim()).filter(Boolean);
