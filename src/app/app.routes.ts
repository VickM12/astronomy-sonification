import { Routes } from '@angular/router';
import { About } from './about/about';
import { Studio } from './studio/studio';

export const routes: Routes = [
  { path: '', component: Studio },
  { path: 'about', component: About },
];
